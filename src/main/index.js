import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { readPdf, splitPdf } from './pdf'
import { indexChunks, searchChunks, clearVectorStore } from './vectorStore'
import { loadApiKey, saveApiKey, getCurrentApiKey } from './config'
import { askGroq, clearMemory } from './groq'

let currentLlmModel = 'openai/gpt-oss-120b'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    minWidth: 600,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  // Load API key from ~/.config/frag/api.key
  await loadApiKey()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('pdf:select-and-read', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow, {
      title: 'Select PDF file',
      properties: ['openFile'],
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    })

    if (canceled || filePaths.length === 0) return null
    return readPdf(filePaths[0])
  })

  ipcMain.handle('pdf:split', (_, filePath, options) => splitPdf(filePath, options))
  ipcMain.handle('vector:index-chunks', (_, chunks) => indexChunks(chunks))
  ipcMain.handle('vector:search', (_, query, limit, minScore) =>
    searchChunks(query, limit, minScore)
  )
  ipcMain.on('llm:set-model', (_, model) => {
    currentLlmModel = model
  })
  ipcMain.handle('llm:get-model', () => currentLlmModel)
  ipcMain.handle('api-key:get', () => getCurrentApiKey())
  ipcMain.handle('api-key:save', (_, key) => saveApiKey(key))
  ipcMain.handle('llm:ask', (_, query, chunks) =>
    askGroq({ query, chunks, model: currentLlmModel })
  )
  ipcMain.handle('app:reset-session', async () => {
    clearVectorStore()
    await clearMemory()
    return true
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
