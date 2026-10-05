import fs from 'fs/promises'
import path from 'path'
import os from 'os'

let apiKey = ''

export function getApiKeyPath() {
  return path.join(os.homedir(), '.config', 'frag', 'api.key')
}

export function getCurrentApiKey() {
  return apiKey
}

export async function loadApiKey() {
  const filePath = getApiKeyPath()
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    const trimmed = data.trim()
    if (trimmed) {
      apiKey = trimmed
      global.apiKey = trimmed
      return trimmed
    }
  } catch {
    // File not found or unreadable
  }
  apiKey = ''
  global.apiKey = ''
  return ''
}

export async function saveApiKey(newKey) {
  const keyToSave = (newKey || '').trim()
  if (!keyToSave) {
    throw new Error('API key cannot be empty')
  }

  const filePath = getApiKeyPath()
  const dirPath = path.dirname(filePath)

  await fs.mkdir(dirPath, { recursive: true })
  await fs.writeFile(filePath, keyToSave, { encoding: 'utf-8', mode: 0o600 })

  apiKey = keyToSave
  global.apiKey = keyToSave
  return apiKey
}
