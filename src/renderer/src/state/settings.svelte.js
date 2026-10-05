export const LLM_MODELS = {
  SPEED: 'openai/gpt-oss-20b',
  ACCURACY: 'openai/gpt-oss-120b'
}

function getStoredNumber(key, defaultValue) {
  if (typeof localStorage === 'undefined') return defaultValue
  const val = Number(localStorage.getItem(key))
  return Number.isFinite(val) && val > 0 ? val : defaultValue
}

class SettingsState {
  mode = $state('accuracy')
  chunkSize = $state(getStoredNumber('frag_chunk_size', 1000))
  chunkOverlap = $state(getStoredNumber('frag_chunk_overlap', 150))

  get llmModel() {
    return this.mode === 'speed' ? LLM_MODELS.SPEED : LLM_MODELS.ACCURACY
  }

  setMode(newMode) {
    if (newMode !== 'speed' && newMode !== 'accuracy') return
    this.mode = newMode
    if (typeof window !== 'undefined') {
      window.llmModel = this.llmModel
      window.api?.setLlmModel?.(this.llmModel)
    }
  }

  setChunkParams(size, overlap) {
    const s = Number(size) || 1000
    const o = Number(overlap) || 0
    this.chunkSize = s
    this.chunkOverlap = o
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('frag_chunk_size', String(s))
      localStorage.setItem('frag_chunk_overlap', String(o))
    }
  }
}

export const settings = new SettingsState()

// Initialize global variable
if (typeof window !== 'undefined') {
  window.llmModel = settings.llmModel
  window.api?.setLlmModel?.(settings.llmModel)
}
