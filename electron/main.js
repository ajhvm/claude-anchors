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

  mainWindow.webContents.openDevTools();
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
  trayIcon = new Tray(path.join(__dirname, '../assets/icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Pause', click: () => mainWindow.webContents.send('pause') },
    { label: 'Resume', click: () => mainWindow.webContents.send('resume') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  trayIcon.setContextMenu(contextMenu);
  trayIcon.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}
