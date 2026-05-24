const { app, BrowserWindow, Menu, Tray, ipcMain, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ConfigManager = require(path.join(__dirname, '../src/services/ConfigManager'));
const AnchorRunner = require(path.join(__dirname, '../src/services/AnchorRunner'));
const Scheduler = require(path.join(__dirname, '../src/services/Scheduler'));
const LogReader = require(path.join(__dirname, '../src/services/LogReader'));
const WindowDetector = require(path.join(__dirname, '../src/services/WindowDetector'));
const StatusService = require(path.join(__dirname, '../src/services/StatusService'));

let mainWindow;
let trayIcon;
const configManager = new ConfigManager();
const anchorRunner = new AnchorRunner(configManager);
const windowDetector = new WindowDetector();
const scheduler = new Scheduler(configManager, anchorRunner, { onUpdate: updateTrayStatus });

// Single-instance lock: a second launch focuses the running app and exits,
// so two schedulers never run at once.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

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
    show: false // start hidden to tray; no window/taskbar entry at login
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  // NOTE: intentionally NOT calling mainWindow.show() — launches hidden.
}

// Startup hidden sweep of leftover app-created tasks (safety net). Runs via
// execFile with windowsHide:true → no console window. The redesigned app
// creates no tasks, so every ClaudeAnchor-* found is stale and removed. The
// legacy S4U tasks are removed separately by Remove-AnchorTasks.ps1 (elevation).
function sweepLeftoverTasks() {
  if (process.platform !== 'win32') return;
  const psScript =
    "Get-ScheduledTask | Where-Object { $_.TaskName -like 'ClaudeAnchor-*' } | " +
    "ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue }";
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript],
    { windowsHide: true }, (err) => {
      if (err) console.error('sweepLeftoverTasks error:', err.message);
    });
}

function updateTrayStatus(status) {
  if (!trayIcon) return;
  let tip = 'Claude Anchors';
  if (status.paused) {
    tip += ' — Paused';
  } else if (status.nextFireAt) {
    const t = new Date(status.nextFireAt);
    const hhmm = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    tip += ` — next ${status.nextAnchor} at ${hhmm}`;
  }
  if (status.lastResult && status.lastResult.ok === false) {
    tip += ' ⚠ last fire failed';
  }
  trayIcon.setToolTip(tip);
}

ipcMain.handle('load-config', () => {
  try { return configManager.load(); }
  catch (err) { console.error('IPC load-config:', err); return configManager.defaultConfig; }
});

ipcMain.handle('save-config', (event, config) => {
  try { return configManager.save(config); }
  catch (err) { console.error('IPC save-config:', err); return false; }
});

ipcMain.handle('get-logs-dir', () => {
  try { return configManager.getLogsDir(); }
  catch (err) { console.error('IPC get-logs-dir:', err); return null; }
});

ipcMain.handle('get-logs', () => {
  try { return new LogReader().getAllLogs(); }
  catch (err) { console.error('IPC get-logs:', err); return []; }
});

// Manual "Fire Now" from the renderer. scheduledTime arg kept for the existing
// App.js call signature but is unused (Scheduler tracks timing).
ipcMain.handle('fire-anchor', async (event, anchor) => {
  try { return await scheduler.fireNow(anchor); }
  catch (err) { console.error('IPC fire-anchor:', err); return false; }
});

ipcMain.handle('detect-window-duration', () => windowDetector.detect(configManager));

ipcMain.on('pause-all', () => { scheduler.setPaused(true); });
ipcMain.on('resume-all', () => { scheduler.setPaused(false); });

ipcMain.handle('apply-config', async () => {
  try { return await scheduler.recompute(); }
  catch (err) { console.error('IPC apply-config:', err); return false; }
});

function configureAutoStart() {
  // Launch on login (the app starts hidden to tray on its own).
  const settings = { openAtLogin: true };
  if (!app.isPackaged) {
    settings.path = process.execPath;
    settings.args = [path.resolve(__dirname, '..')];
  }
  app.setLoginItemSettings(settings);
}

function setupTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  if (!fs.existsSync(iconPath)) {
    console.warn('Tray icon not found at ' + iconPath);
    return;
  }
  trayIcon = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow && mainWindow.show() },
    { label: 'Fire Now', click: () => {
        const active = StatusService.getActiveWindow(configManager.load());
        if (active) scheduler.fireNow(active.anchor);
    } },
    { label: 'Pause', click: () => scheduler.setPaused(true) },
    { label: 'Resume', click: () => scheduler.setPaused(false) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  trayIcon.setContextMenu(contextMenu);
  trayIcon.setToolTip('Claude Anchors');
  trayIcon.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

app.on('ready', () => {
  configureAutoStart();
  createWindow();
  setupTray();
  sweepLeftoverTasks();
  scheduler.start().catch((err) => console.error('Scheduler start error:', err));
  // Detect window duration in the background; if it changes the config,
  // recompute so the armed timer reflects the new window boundaries.
  windowDetector.detect(configManager)
    .then((changed) => { if (changed) return scheduler.recompute(); })
    .catch((err) => console.error('WindowDetector error on startup:', err));
  powerMonitor.on('resume', () => {
    scheduler.recompute().catch((err) => console.error('Scheduler resume error:', err));
  });
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('before-quit', () => {
  app.quitting = true;
  scheduler.stop();
  if (trayIcon) trayIcon.destroy();
});
