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
  try {
    apiKey = (await fs.readFile(getApiKeyPath(), 'utf-8')).trim()
  } catch {
    apiKey = ''
  }
  return apiKey
}

export async function saveApiKey(newKey) {
  const keyToSave = (newKey || '').trim()
  if (!keyToSave) {
    throw new Error('API key cannot be empty')
  }

  const filePath = getApiKeyPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, keyToSave, { encoding: 'utf-8', mode: 0o600 })

  apiKey = keyToSave
  return apiKey
}
