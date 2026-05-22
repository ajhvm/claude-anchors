const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let trayIcon;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    minWidth: 500,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }
}

app.on('ready', () => {
  createWindow();
  setupTray();
});

app.on('window-all-closed', () => {
  // Don't quit; stay in tray
});

app.on('before-quit', () => {
  app.quitting = true;
});

function setupTray() {
  const { Tray } = require('electron');
  const fs = require('fs');

  const iconPath = path.join(__dirname, '../assets/icon.png');

  // Only create tray if icon exists; gracefully handle missing icon
  if (!fs.existsSync(iconPath)) {
    console.warn('Tray icon not found at ' + iconPath);
    return;
  }

  trayIcon = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow && mainWindow.show() },
    { label: 'Pause', click: () => mainWindow && mainWindow.webContents.send('pause') },
    { label: 'Resume', click: () => mainWindow && mainWindow.webContents.send('resume') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  trayIcon.setContextMenu(contextMenu);
  trayIcon.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}
