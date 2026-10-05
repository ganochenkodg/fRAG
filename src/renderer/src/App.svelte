<script>
  import { onMount, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import labelLogo from './assets/label.png'
  import { settings } from './state/settings.svelte.js'
  import ApiKeyModal from './components/ApiKeyModal.svelte'
  import SettingsModal from './components/SettingsModal.svelte'

  let isLoading = $state(false)
  let loadedFile = $state(null)
  let errorMessage = $state('')
  let queryText = $state('')
  let messages = $state([])
  let isSearching = $state(false)
  let chatMessagesEl = $state(null)

  let showApiKeyModal = $state(false)
  let showConfigModal = $state(false)
  let messageId = 0

  onMount(async () => {
    try {
      const key = await window.api.getApiKey()
      if (!key || !key.trim()) {
        showApiKeyModal = true
      }
    } catch {
      showApiKeyModal = true
    }
  })

  function extractSubqueries(text) {
    const clean = text
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2)
    return clean.length > 0 ? clean : [text.trim()]
  }

  function deduplicateChunks(chunkLists) {
    const chunkMap = Object.create(null)
    for (const chunkList of chunkLists) {
      if (!Array.isArray(chunkList)) continue
      for (const chunk of chunkList) {
        const key = chunk.metadata?.id !== undefined ? String(chunk.metadata.id) : chunk.content
        if (!chunkMap[key] || (chunk.score || 0) > (chunkMap[key].score || 0)) {
          chunkMap[key] = chunk
        }
      }
    }
    return Object.values(chunkMap).sort((a, b) => (b.score || 0) - (a.score || 0))
  }

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

        const indexResult = await window.api.indexChunks(splitResult.chunks)
        if (indexResult) {
          const durationSec = (indexResult.durationMs / 1000).toFixed(1)
          messageId += 1
          messages.push({
            id: messageId,
            role: 'assistant',
            text: `Data successfully processed and indexed in ${durationSec}s. How can I help you?`
          })
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

  $effect(() => {
    if (messages.length || isSearching) {
      tick().then(() => {
        if (chatMessagesEl) {
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight
        }
      })
    }
  })

  async function handleSendMessage(e) {
    e?.preventDefault()
    const query = queryText.trim()
    if (!query || isSearching) return

    messageId += 1
    messages.push({ id: messageId, role: 'user', text: query })
    queryText = ''

    try {
      isSearching = true
      const subqueries = extractSubqueries(query)
      const searchResults = await Promise.all(
        subqueries.map((subQ) => window.api.searchChunks(subQ, 2, 0.7))
      )
      const deduplicatedChunks = deduplicateChunks(searchResults)
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
        onclick={() => (showConfigModal = true)}
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

  <section class="content-area">
    {#if !loadedFile}
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

  <ApiKeyModal bind:open={showApiKeyModal} />
  <SettingsModal bind:open={showConfigModal} />
</main>
