<script>
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import labelLogo from './assets/label.png'
  import { settings } from './state/settings.svelte.js'

  let isLoading = $state(false)
  let loadedFile = $state(null)
  let errorMessage = $state('')
  let queryText = $state('')
  let messages = $state([])

  let showApiKeyModal = $state(false)
  let inputApiKey = $state('')
  let apiKeyError = $state('')
  let isSavingApiKey = $state(false)

  onMount(async () => {
    try {
      const key = await window.api.getApiKey()
      if (key && key.trim()) {
        window.apiKey = key.trim()
      } else {
        showApiKeyModal = true
      }
    } catch (err) {
      console.error('Failed to load API key:', err)
      showApiKeyModal = true
    }
  })

  async function handleSaveApiKey(e) {
    e?.preventDefault()
    const trimmed = inputApiKey.trim()
    if (!trimmed) {
      apiKeyError = 'API key cannot be empty'
      return
    }

    apiKeyError = ''
    isSavingApiKey = true
    try {
      await window.api.saveApiKey(trimmed)
      window.apiKey = trimmed
      showApiKeyModal = false
    } catch (err) {
      console.error('Failed to save API key:', err)
      apiKeyError = 'Failed to save API key'
    } finally {
      isSavingApiKey = false
    }
  }

  let showConfigModal = $state(false)
  let configChunkSize = $state(settings.chunkSize)
  let configChunkOverlap = $state(settings.chunkOverlap)
  let configError = $state('')

  function handleOpenConfig() {
    configChunkSize = settings.chunkSize
    configChunkOverlap = settings.chunkOverlap
    configError = ''
    showConfigModal = true
  }

  function handleSaveConfig(e) {
    e?.preventDefault()
    const size = Number(configChunkSize)
    const overlap = Number(configChunkOverlap)

    if (!size || size < 100) {
      configError = 'Chunk size must be at least 100.'
      return
    }
    if (overlap < 0) {
      configError = 'Chunk overlap cannot be negative.'
      return
    }
    if (overlap >= size) {
      configError = 'Chunk overlap must be less than chunk size.'
      return
    }

    settings.setChunkParams(size, overlap)
    showConfigModal = false
  }

  function extractSubqueries(text) {
    const rawSegments = text.split(/[.!?\n]+/)
    const clean = rawSegments.map((s) => s.trim()).filter((s) => s.length > 2)
    return clean.length > 0 ? clean : [text.trim()]
  }

  let messageId = 0

  async function handleSelectFile() {
    if (isLoading) return
    errorMessage = ''

    try {
      isLoading = true
      const result = await window.api.selectAndReadPdf()
      if (result) {
        await window.api?.resetSession?.()
        loadedFile = result
        messageId = 1
        messages = [
          {
            id: 1,
            role: 'assistant',
            text: `File "${result.fileName}" loaded (${result.totalPages} pages).`
          }
        ]
        console.log('File read before splitting:', result)

        splitDocument(result.filePath)
      }
    } catch (err) {
      console.error('Error reading PDF:', err)
      errorMessage = 'Failed to read PDF file'
    } finally {
      isLoading = false
    }
  }

  async function splitDocument(filePath) {
    try {
      const splitResult = await window.api.splitPdf(filePath, {
        chunkSize: settings.chunkSize,
        chunkOverlap: settings.chunkOverlap
      })
      if (splitResult) {
        messageId += 1
        messages.push({
          id: messageId,
          role: 'assistant',
          text: `Document successfully split into ${splitResult.chunksCount} chunks. Embedding and indexing data...`
        })
        console.log('Chunks ready for vectorization:', splitResult.chunks)

        const indexResult = await window.api.indexChunks(splitResult.chunks)
        if (indexResult) {
          const durationSec = (indexResult.durationMs / 1000).toFixed(1)
          messageId += 1
          messages.push({
            id: messageId,
            role: 'assistant',
            text: `Data successfully processed and indexed in ${durationSec}s. How can I help you?`
          })
          console.log('Indexed in LangChain MemoryVectorStore:', indexResult)
        }
      }
    } catch (err) {
      console.error('Error processing document:', err)
      messageId += 1
      messages.push({
        id: messageId,
        role: 'assistant',
        text: 'Failed to process and index document.'
      })
    }
  }

  async function handleResetFile() {
    loadedFile = null
    messages = []
    queryText = ''
    errorMessage = ''
    try {
      await window.api?.resetSession?.()
    } catch (err) {
      console.error('Failed to reset session:', err)
    }
  }

  let isSearching = $state(false)
  let chatMessagesEl = $state(null)

  $effect(() => {
    if (messages.length || isSearching) {
      setTimeout(() => {
        if (chatMessagesEl) {
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight
        }
      }, 50)
    }
  })

  async function handleSendMessage(e) {
    e?.preventDefault()
    const query = queryText.trim()
    if (!query || isSearching) return

    messageId += 1
    messages.push({
      id: messageId,
      role: 'user',
      text: query
    })

    queryText = ''

    try {
      isSearching = true

      // Split query into subqueries by sentence terminators (. ? ! \n)
      const subqueries = extractSubqueries(query)

      // Search each subquery for top 2 relevant chunks with similarity score >= 0.7
      const searchResults = await Promise.all(
        subqueries.map((subQ) => window.api.searchChunks(subQ, 2, 0.7))
      )

      // Deduplicate chunks across subqueries keeping highest similarity score
      const chunkMap = Object.create(null)
      for (const chunkList of searchResults) {
        if (!Array.isArray(chunkList)) continue
        for (const chunk of chunkList) {
          const key = chunk.metadata?.id !== undefined ? String(chunk.metadata.id) : chunk.content
          if (!chunkMap[key]) {
            chunkMap[key] = chunk
          } else {
            const existing = chunkMap[key]
            if ((chunk.score || 0) > (existing.score || 0)) {
              chunkMap[key] = chunk
            }
          }
        }
      }

      const deduplicatedChunks = Object.values(chunkMap).sort(
        (a, b) => (b.score || 0) - (a.score || 0)
      )

      // Query Groq Cloud LLM with full query and retrieved deduplicated chunks
      const result = await window.api.askLlm(query, deduplicatedChunks)

      messageId += 1
      const sources = deduplicatedChunks.map((chunk) => ({
        page: chunk.metadata?.pageNumber,
        score: chunk.score
      }))

      messages.push({
        id: messageId,
        role: 'assistant',
        text: result?.answer || 'No response generated.',
        sources
      })
    } catch (err) {
      console.error('Error generating answer:', err)
      messageId += 1
      const errStr = err?.message || 'Failed to generate answer.'
      messages.push({
        id: messageId,
        role: 'assistant',
        text: `Error: ${errStr}`
      })

      if (errStr.toLowerCase().includes('api key') || errStr.includes('401')) {
        showApiKeyModal = true
      }
    } finally {
      isSearching = false
    }
  }
</script>

<main class="page">
  <header class="header">
    <img src={labelLogo} alt="Logo" class="logo" />

    <div class="header-actions">
      <button
        type="button"
        class="config-btn"
        onclick={handleOpenConfig}
        title="Configure chunking settings"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          ></path>
        </svg>
        <span>configure</span>
      </button>

      <div class="model-switch" role="group" aria-label="Model selection">
        <button
          type="button"
          class="switch-btn"
          class:active={settings.mode === 'speed'}
          onclick={() => settings.setMode('speed')}
        >
          speed
        </button>
        <button
          type="button"
          class="switch-btn"
          class:active={settings.mode === 'accuracy'}
          onclick={() => settings.setMode('accuracy')}
        >
          accuracy
        </button>
      </div>
    </div>
  </header>

  <!-- Workspace area occupying remaining window space with equal margins -->
  <section class="content-area">
    {#if !loadedFile}
      <!-- Load file dropzone filling entire area -->
      <button
        type="button"
        class="dropzone-box"
        class:loading={isLoading}
        onclick={handleSelectFile}
        transition:fade={{ duration: 200 }}
        title="Click to select PDF file"
      >
        <div class="icon-wrapper">
          <svg class="pdf-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 6C12 4.89543 12.8954 4 14 4H28L38 14V42C38 43.1046 37.1046 44 36 44H14C12.8954 44 12 43.1046 12 42V6Z"
              fill="#FFFFFF"
              stroke="#8E7E73"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
            <path
              d="M28 4V14H38"
              fill="#E8DED6"
              stroke="#8E7E73"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
            <rect x="8" y="22" width="24" height="13" rx="3" fill="#E53935" />
            <text
              x="20"
              y="31.5"
              font-size="7.5"
              font-weight="bold"
              fill="white"
              text-anchor="middle"
              font-family="sans-serif">PDF</text
            >
          </svg>
        </div>

        <span class="label-text">load file</span>
      </button>
    {:else}
      <!-- Chat interface filling the exact same area -->
      <div class="chat-container" transition:fade={{ duration: 200 }}>
        <div class="chat-header">
          <div class="file-badge">
            <span class="file-badge-icon">📄</span>
            <span class="file-badge-name" title={loadedFile.filePath}>{loadedFile.fileName}</span>
            <span class="file-badge-pages">({loadedFile.totalPages} pages)</span>
          </div>

          <button type="button" class="change-file-btn" onclick={handleResetFile}>
            Change file
          </button>
        </div>

        <div class="chat-messages" bind:this={chatMessagesEl}>
          {#each messages as msg (msg.id)}
            <div class="message-bubble {msg.role}">
              <div class="message-content">
                <div class="message-text">{msg.text}</div>
                {#if msg.sources}
                  <div class="message-sources">
                    <span class="sources-label">Sources:</span>
                    {#if msg.sources.length > 0}
                      {#each msg.sources as src, i (i)}
                        <span class="source-tag">
                          {src.page ? `Page ${src.page}` : `Excerpt #${i + 1}`}
                          {#if typeof src.score === 'number'}
                            <span class="source-score">({src.score.toFixed(3)})</span>
                          {/if}
                        </span>
                      {/each}
                    {:else}
                      <span class="source-empty">No relevant chunks found</span>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}

          {#if isSearching}
            <div class="message-bubble assistant">
              <div class="message-content thinking">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
              </div>
            </div>
          {/if}
        </div>

        <form class="chat-input-form" onsubmit={handleSendMessage}>
          <input
            type="text"
            class="chat-input"
            placeholder={isSearching
              ? 'Generating answer...'
              : 'Ask a question about the document...'}
            bind:value={queryText}
            disabled={isSearching}
          />
          <button
            type="submit"
            class="send-btn"
            disabled={!queryText.trim() || isSearching}
            title="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>
    {/if}

    {#if errorMessage}
      <p class="error-text">{errorMessage}</p>
    {/if}
  </section>

  {#if showApiKeyModal}
    <div class="modal-overlay" transition:fade={{ duration: 150 }}>
      <div class="modal-card">
        <h2 class="modal-title">API Key Required</h2>
        <p class="modal-desc">
          Please enter your Groq Cloud API key to continue. It will be stored in <code
            >~/.config/frag/api.key</code
          >.
        </p>

        <form class="modal-form" onsubmit={handleSaveApiKey}>
          <input
            type="password"
            class="modal-input"
            placeholder="Enter your API key..."
            bind:value={inputApiKey}
            disabled={isSavingApiKey}
            autocomplete="off"
            spellcheck="false"
          />

          {#if apiKeyError}
            <p class="modal-error">{apiKeyError}</p>
          {/if}

          <div class="modal-actions">
            <button
              type="submit"
              class="modal-btn"
              disabled={!inputApiKey.trim() || isSavingApiKey}
            >
              {isSavingApiKey ? 'Saving...' : 'Save API Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if showConfigModal}
    <div class="modal-overlay" transition:fade={{ duration: 150 }}>
      <div class="modal-card">
        <h2 class="modal-title">Chunking Settings</h2>
        <p class="modal-desc">
          Configure document splitting parameters. Changes apply to newly loaded documents.
        </p>

        <form class="modal-form" onsubmit={handleSaveConfig}>
          <div class="form-field">
            <label class="form-label" for="cfg-chunk-size">Chunk Size (chars):</label>
            <input
              id="cfg-chunk-size"
              type="number"
              class="modal-input"
              min="100"
              max="8000"
              step="50"
              bind:value={configChunkSize}
              required
            />
          </div>

          <div class="form-field">
            <label class="form-label" for="cfg-chunk-overlap">Chunk Overlap (chars):</label>
            <input
              id="cfg-chunk-overlap"
              type="number"
              class="modal-input"
              min="0"
              max="2000"
              step="25"
              bind:value={configChunkOverlap}
              required
            />
          </div>

          {#if configError}
            <p class="modal-error">{configError}</p>
          {/if}

          <div class="modal-actions">
            <button
              type="button"
              class="modal-btn-cancel"
              onclick={() => (showConfigModal = false)}
            >
              Cancel
            </button>
            <button type="submit" class="modal-btn"> Save </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</main>

<style>
  .page {
    padding: 24px;
    box-sizing: border-box;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    flex-shrink: 0;
  }

  .logo {
    display: block;
    max-width: 180px;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .config-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.65);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(158, 142, 130, 0.35);
    border-radius: 20px;
    padding: 6px 13px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    color: #7a6b60;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    transition: all 0.2s ease;
    user-select: none;
    outline: none;
  }

  .config-btn:hover {
    color: #3b322b;
    background: rgba(255, 255, 255, 0.88);
    border-color: #9e8e82;
  }

  /* Segmented switch: speed / accuracy */
  .model-switch {
    display: inline-flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.65);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(158, 142, 130, 0.35);
    border-radius: 20px;
    padding: 3px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  }

  .switch-btn {
    border: none;
    background: transparent;
    color: #7a6b60;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 5px 14px;
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
    outline: none;
  }

  .switch-btn:hover:not(.active) {
    color: #3b322b;
    background: rgba(255, 255, 255, 0.4);
  }

  .switch-btn.active {
    background: #5d4e44;
    color: #ffffff;
    font-weight: 600;
    box-shadow: 0 2px 6px rgba(93, 78, 68, 0.25);
  }

  /* Content area fills remaining space with equal margins */
  .content-area {
    margin-top: 24px;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* Dropzone button fills entire area */
  .dropzone-box {
    width: 100%;
    height: 100%;
    border: 2px dashed #9e8e82;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.65);
    backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background-color 0.2s ease;
    padding: 20px;
    box-sizing: border-box;
    font-family: inherit;
    outline: none;
  }

  .dropzone-box:hover {
    border-color: #6b5c51;
    background: rgba(255, 255, 255, 0.88);
    box-shadow: 0 0 16px rgba(158, 142, 130, 0.35);
  }

  .dropzone-box.loading {
    opacity: 0.7;
    cursor: wait;
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pdf-icon {
    width: 52px;
    height: 52px;
  }

  .label-text {
    font-size: 14px;
    font-weight: 600;
    color: #4a3e35;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  /* Chat container */
  .chat-container {
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(158, 142, 130, 0.35);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  }

  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(158, 142, 130, 0.25);
    background: rgba(255, 255, 255, 0.55);
    font-size: 13px;
    flex-shrink: 0;
  }

  .file-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #3b322b;
    font-weight: 600;
    max-width: 75%;
    overflow: hidden;
  }

  .file-badge-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-badge-pages {
    font-size: 12px;
    color: #7a6b60;
    font-weight: 400;
    white-space: nowrap;
  }

  .change-file-btn {
    border: none;
    background: transparent;
    color: #7a6b60;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.2s ease;
  }

  .change-file-btn:hover {
    color: #3b322b;
    background: rgba(158, 142, 130, 0.15);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message-bubble {
    display: flex;
    max-width: 85%;
  }

  .message-bubble.user {
    align-self: flex-end;
  }

  .message-bubble.assistant {
    align-self: flex-start;
  }

  .message-content {
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.45;
  }

  .message-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-sources {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed rgba(158, 142, 130, 0.35);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #7a6b60;
  }

  .sources-label {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.3px;
  }

  .source-tag {
    background: rgba(158, 142, 130, 0.15);
    padding: 2px 7px;
    border-radius: 6px;
    font-weight: 500;
    color: #4a3e35;
  }

  .source-score {
    color: #6b5c51;
    font-size: 10px;
    margin-left: 2px;
  }

  .source-empty {
    font-style: italic;
    color: #8e7e73;
    font-size: 11px;
  }

  .thinking {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 12px 16px;
  }

  .thinking-dot {
    width: 6px;
    height: 6px;
    background: #8e7e73;
    border-radius: 50%;
    animation: pulse 1.4s infinite ease-in-out both;
  }

  .thinking-dot:nth-child(1) {
    animation-delay: -0.32s;
  }

  .thinking-dot:nth-child(2) {
    animation-delay: -0.16s;
  }

  @keyframes pulse {
    0%,
    80%,
    100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .message-bubble.user .message-content {
    background: #5d4e44;
    color: #ffffff;
    border-bottom-right-radius: 4px;
  }

  .message-bubble.assistant .message-content {
    background: rgba(255, 255, 255, 0.9);
    color: #3b322b;
    border: 1px solid rgba(158, 142, 130, 0.25);
    border-bottom-left-radius: 4px;
  }

  .chat-input-form {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid rgba(158, 142, 130, 0.25);
    background: rgba(255, 255, 255, 0.55);
    flex-shrink: 0;
  }

  .chat-input {
    flex: 1;
    border: 1px solid rgba(158, 142, 130, 0.35);
    background: #ffffff;
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.2s ease;
  }

  .chat-input:focus {
    border-color: #5d4e44;
  }

  .send-btn {
    border: none;
    background: #5d4e44;
    color: white;
    border-radius: 10px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: opacity 0.2s ease;
    flex-shrink: 0;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):hover {
    background: #4a3e35;
  }

  .error-text {
    font-size: 13px;
    color: #c53030;
    font-weight: 500;
    margin-top: 6px;
  }

  /* API Key Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(45, 36, 30, 0.45);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
    box-sizing: border-box;
  }

  .modal-card {
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(158, 142, 130, 0.4);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.15);
    border-radius: 18px;
    padding: 24px;
    width: 100%;
    max-width: 400px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #3b322b;
  }

  .modal-desc {
    margin: 0;
    font-size: 13px;
    color: #6b5c51;
    line-height: 1.45;
  }

  .modal-desc code {
    background: rgba(158, 142, 130, 0.15);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 12px;
    color: #4a3e35;
  }

  .modal-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 4px;
  }

  .modal-input {
    width: 100%;
    border: 1px solid rgba(158, 142, 130, 0.35);
    background: #ffffff;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
    transition: border-color 0.2s ease;
  }

  .modal-input:focus {
    border-color: #5d4e44;
  }

  .modal-error {
    margin: 0;
    font-size: 12px;
    color: #c53030;
    font-weight: 500;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 600;
    color: #4a3e35;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }

  .modal-btn-cancel {
    border: 1px solid rgba(158, 142, 130, 0.4);
    background: transparent;
    color: #6b5c51;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .modal-btn-cancel:hover {
    background: rgba(158, 142, 130, 0.15);
    color: #3b322b;
  }

  .modal-btn {
    border: none;
    background: #5d4e44;
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .modal-btn:hover:not(:disabled) {
    background: #4a3e35;
  }

  .modal-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
