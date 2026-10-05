<script>
  import { fade } from 'svelte/transition'

  let { open = $bindable(false) } = $props()

  let inputApiKey = $state('')
  let apiKeyError = $state('')
  let isSavingApiKey = $state(false)

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
      inputApiKey = ''
      open = false
    } catch (err) {
      console.error('Failed to save API key:', err)
      apiKeyError = 'Failed to save API key'
    } finally {
      isSavingApiKey = false
    }
  }
</script>

{#if open}
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
          <button type="submit" class="modal-btn" disabled={!inputApiKey.trim() || isSavingApiKey}>
            {isSavingApiKey ? 'Saving...' : 'Save API Key'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
