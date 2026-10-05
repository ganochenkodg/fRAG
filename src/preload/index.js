import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectAndReadPdf: () => ipcRenderer.invoke('pdf:select-and-read'),
  splitPdf: (filePath, options) => ipcRenderer.invoke('pdf:split', filePath, options),
  indexChunks: (chunks) => ipcRenderer.invoke('vector:index-chunks', chunks),
  searchChunks: (query, limit, minScore) =>
    ipcRenderer.invoke('vector:search', query, limit, minScore),
  setLlmModel: (model) => ipcRenderer.send('llm:set-model', model),
  getApiKey: () => ipcRenderer.invoke('api-key:get'),
  saveApiKey: (key) => ipcRenderer.invoke('api-key:save', key),
  askLlm: (query, chunks) => ipcRenderer.invoke('llm:ask', query, chunks),
  resetSession: () => ipcRenderer.invoke('app:reset-session')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
