const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const ConfigManager = require(path.join(__dirname, '../src/services/ConfigManager'));
const TaskManager = require(path.join(__dirname, '../src/services/TaskManager'));
const LogReader = require(path.join(__dirname, '../src/services/LogReader'));
const WindowDetector = require(path.join(__dirname, '../src/services/WindowDetector'));

let mainWindow;
let trayIcon;
const configManager = new ConfigManager();
const taskManager = new TaskManager();
const windowDetector = new WindowDetector();

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

  const config = configManager.load();

  // updateTasks() sweeps legacy tasks internally before registering, so a
  // separate cleanupLegacyTasks() call here would race the same unregisters.
  taskManager.updateTasks(config).catch(err => {
    console.error('Error initializing tasks on startup:', err);
  });

  windowDetector.detect(configManager).catch(err => {
    console.error('WindowDetector error on startup:', err);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.show();
}

ipcMain.handle('load-config', () => {
  try {
    return configManager.load();
  } catch (err) {
    console.error('IPC error loading config:', err);
    return configManager.defaultConfig;
  }
});

ipcMain.handle('save-config', (event, config) => {
  try {
    return configManager.save(config);
  } catch (err) {
    console.error('IPC error saving config:', err);
    return false;
  }
});

ipcMain.handle('get-logs-dir', () => {
  try {
    return configManager.getLogsDir();
  } catch (err) {
    console.error('IPC error getting logs dir:', err);
    return null;
  }
});

ipcMain.handle('get-logs', () => {
  try {
    const logReader = new LogReader();
    return logReader.getAllLogs();
  } catch (err) {
    console.error('IPC error getting logs:', err);
    return [];
  }
});

ipcMain.handle('fire-anchor', (event, anchor, scheduledTime) => {
  try {
    return taskManager.fireAnchor(anchor, scheduledTime);
  } catch (err) {
    console.error('IPC error firing anchor:', err);
    return false;
  }
});

ipcMain.handle('detect-window-duration', () => {
  return windowDetector.detect(configManager);
});

ipcMain.on('pause-all', () => { taskManager.pauseAll(); });
ipcMain.on('resume-all', () => { taskManager.resumeAll(); });

ipcMain.handle('apply-config', (event, config) => {
  try {
    return taskManager.updateTasks(config);
  } catch (err) {
    console.error('IPC error in apply-config:', err);
    return false;
  }
});

function configureAutoStart() {
  // Launch on login showing the window (taskbar presence), not hidden to tray.
  const settings = { openAtLogin: true };
  if (!app.isPackaged) {
    // Dev run (`electron .`): point the login item at the electron binary +
    // project dir so login relaunches the app rather than a bare Electron shell.
    settings.path = process.execPath;
    settings.args = [path.resolve(__dirname, '..')];
  }
  app.setLoginItemSettings(settings);
}

app.on('ready', () => {
  configureAutoStart();
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
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}
