<script>
  import { fade } from 'svelte/transition'
  import { settings } from '../state/settings.svelte.js'

  let { open = $bindable(false) } = $props()

  let configChunkSize = $state(settings.chunkSize)
  let configChunkOverlap = $state(settings.chunkOverlap)
  let configError = $state('')

  $effect(() => {
    if (open) {
      configChunkSize = settings.chunkSize
      configChunkOverlap = settings.chunkOverlap
      configError = ''
    }
  })

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
    open = false
  }
</script>

{#if open}
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
          <button type="button" class="modal-btn-cancel" onclick={() => (open = false)}>
            Cancel
          </button>
          <button type="submit" class="modal-btn"> Save </button>
        </div>
      </form>
    </div>
  </div>
{/if}
