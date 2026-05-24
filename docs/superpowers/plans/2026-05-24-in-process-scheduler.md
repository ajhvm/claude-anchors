# In-Process Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all OS scheduled tasks with an in-process timer in the tray app, so anchors fire via `windowsHide` and popup windows become structurally impossible.

**Architecture:** A `Scheduler` (main process) holds at most one `setTimeout` to the next window; on fire it runs an anchor via `AnchorRunner` (which spawns `claude -p` hidden) and re-arms. On launch/wake/config-save it recomputes, firing any active-but-unfired window (catch-up) and arming the next. No Windows Task Scheduler entries anywhere. `TaskManager` and all `.ps1`/`.sh` runner scripts are deleted.

**Tech Stack:** Electron 28 (Node 18), CommonJS modules, plain-Node `console.assert` tests run via `node tests/<file>.test.js`.

**Spec:** `docs/superpowers/specs/2026-05-24-in-process-scheduler-design.md`

---

## File Structure

**New files:**
- `src/services/AnchorRunner.js` — fires `claude -p` hidden, writes the per-window log. Replaces all runner scripts.
- `src/services/Scheduler.js` — owns timing: pure `plan()` core + imperative `recompute()`/timer shell.
- `Remove-AnchorTasks.ps1` — one-time elevated sweep of all anchor tasks (both generations).
- `tests/AnchorRunner.test.js`, `tests/Scheduler.test.js`

**Modified:**
- `electron/main.js` — wire Scheduler + AnchorRunner, single-instance lock, hidden-to-tray launch, `powerMonitor` resume, re-route IPC, startup self-sweep. Remove TaskManager.
- `package.json` — add `test` script; remove unused `node-schedule` dependency.

**Deleted:**
- `src/services/TaskManager.js`
- `scripts/anchor-runner.ps1`, `scripts/anchor-runner.sh`
- `scripts/W1-Primary.ps1`, `W1-Backup.ps1`, `W2-Primary.ps1`, `W2-Backup.ps1`, `W3-Primary.ps1`, `W3-Backup.ps1`, `W4-Primary.ps1`, `W4-Backup.ps1`

**Unchanged (do NOT touch — IPC contract and pure helpers are preserved):**
- `src/App.js` — still calls `fire-anchor`, `apply-config`, `pause-all`, `resume-all`, `save-config`, `load-config`, `get-logs`, `detect-window-duration`. main.js keeps all these channel names.
- `src/services/StatusService.js` — pure config+logs; reused by Scheduler.
- `src/services/LogReader.js`, `src/services/ConfigManager.js`, `src/services/WindowDetector.js`, `electron/preload.js`.

---

## Task 1: AnchorRunner — fire `claude -p` hidden + log

**Files:**
- Create: `src/services/AnchorRunner.js`
- Test: `tests/AnchorRunner.test.js`

AnchorRunner injects `execFile` so tests run without a real `claude` binary. It writes log entries in the exact format `LogReader` parses (`=== <ts> ===` then a body line of `OK` / `SKIPPED: …` / `ERROR: …`).

- [ ] **Step 1: Write the failing test**

Create `tests/AnchorRunner.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const AnchorRunner = require('../src/services/AnchorRunner');
const LogReader = require('../src/services/LogReader');

// Fake ConfigManager pointing logs at a throwaway temp dir.
function makeFakeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-test-'));
  return {
    dir,
    getLogsDir: () => dir,
    load: () => ({ prompt: 'New context window open. Reply OK only.' })
  };
}

function readEntries(dir, anchor) {
  // LogReader reads ~/.claude-anchors/logs by default; parse our temp file directly.
  const content = fs.readFileSync(path.join(dir, `${anchor}.log`), 'utf-8');
  return new LogReader().parseLogFile(content, `${anchor}.log`);
}

async function testFireSuccess() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => cb(null, 'OK\n', '');
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w1');
  console.assert(res.ok === true, `fire ok=true, got ${res.ok}`);
  console.assert(res.reply === 'OK', `reply 'OK', got '${res.reply}'`);
  const entries = readEntries(cfg.dir, 'w1');
  console.assert(entries.length === 1, `1 log entry, got ${entries.length}`);
  console.assert(entries[0].status === 'ok', `status ok, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.fire success passed');
}

async function testFireFailure() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => cb(new Error('claude not found'), '', '');
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w2');
  console.assert(res.ok === false, `fire ok=false, got ${res.ok}`);
  const entries = readEntries(cfg.dir, 'w2');
  console.assert(entries[0].status === 'error', `status error, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.fire failure passed');
}

function testLogSkipped() {
  const cfg = makeFakeConfig();
  const runner = new AnchorRunner(cfg, () => {});
  runner.logSkipped('w3');
  const entries = readEntries(cfg.dir, 'w3');
  console.assert(entries[0].status === 'skipped', `status skipped, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.logSkipped passed');
}

function testTimestampFormat() {
  const runner = new AnchorRunner({ getLogsDir: () => '.', load: () => ({}) }, () => {});
  const ts = runner._timestamp(new Date(2026, 4, 24, 5, 3, 9)); // May=4
  console.assert(ts === '2026-05-24 05:03:09', `timestamp format, got '${ts}'`);
  console.log('✓ AnchorRunner._timestamp passed');
}

(async () => {
  await testFireSuccess();
  await testFireFailure();
  testLogSkipped();
  testTimestampFormat();
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/AnchorRunner.test.js`
Expected: FAIL — `Cannot find module '../src/services/AnchorRunner'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/AnchorRunner.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

class AnchorRunner {
  // execFileFn is injectable for testing; defaults to child_process.execFile.
  constructor(configManager, execFileFn) {
    this.configManager = configManager;
    this._execFile = execFileFn || require('child_process').execFile;
  }

  _claudePath() {
    return os.platform() === 'win32'
      ? path.join(process.env.APPDATA, 'npm', 'claude.cmd')
      : 'claude';
  }

  _timestamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  _appendLog(anchor, body) {
    const logFile = path.join(this.configManager.getLogsDir(), `${anchor}.log`);
    fs.appendFileSync(logFile, `=== ${this._timestamp()} ===\n${body}\n\n`, 'utf-8');
  }

  logSkipped(anchor) {
    this._appendLog(anchor, 'SKIPPED: Window expired');
  }

  // Fires the anchor and records the result. Resolves { ok, reply }.
  fire(anchor) {
    return new Promise((resolve) => {
      const config = this.configManager.load();
      const claude = this._claudePath();
      this._execFile(
        claude,
        ['-p', config.prompt],
        { timeout: 60000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            this._appendLog(anchor, `ERROR: ${err.message}`);
            resolve({ ok: false, reply: '' });
            return;
          }
          const reply = (stdout || '').trim();
          this._appendLog(anchor, reply || 'ERROR: empty response');
          resolve({ ok: reply.length > 0, reply });
        }
      );
    });
  }
}

module.exports = AnchorRunner;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/AnchorRunner.test.js`
Expected: four `✓` lines, no `Assertion failed` output.

- [ ] **Step 5: Commit**

```bash
git add src/services/AnchorRunner.js tests/AnchorRunner.test.js
git commit -m "feat: AnchorRunner — fire claude -p hidden, write parseable log"
```

---

## Task 2: Scheduler — pure plan() core

**Files:**
- Create: `src/services/Scheduler.js`
- Test: `tests/Scheduler.test.js`

`Scheduler.plan(config, logs, now)` is pure: given config, today's logs, and a clock, it returns `{ toFire, nextFireAt, nextAnchor }`. It reuses `StatusService.getWindowTimes` (DRY). This is the heart of the scheduler and gets full coverage. The imperative shell is added in Task 3-prep below (same file, same task).

- [ ] **Step 1: Write the failing test**

Create `tests/Scheduler.test.js`:

```js
const Scheduler = require('../src/services/Scheduler');

const STD = { startTime: '05:00', windowCount: 4, windowDuration: 5 }; // 5,10,15,20h

function testNextIsW1WhenBeforeStart() {
  const now = new Date(2026, 5, 15, 2, 0, 0); // 02:00, before 05:00
  const { toFire, nextAnchor } = Scheduler.plan(STD, [], now);
  console.assert(toFire.length === 0, `no catch-up, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w1', `next w1, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan before-start passed');
}

function testCatchUpActiveWindow() {
  const now = new Date(2026, 5, 15, 11, 0, 0); // 11:00 → inside w2 (10:00-15:00)
  const { toFire, nextAnchor } = Scheduler.plan(STD, [], now);
  console.assert(toFire.length === 1 && toFire[0] === 'w2', `catch-up w2, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w3', `next w3, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan catch-up active passed');
}

function testNoCatchUpWhenAlreadyFired() {
  const now = new Date(2026, 5, 15, 11, 0, 0);
  const logs = [{ anchor: 'w2', timestamp: '2026-06-15 10:01:00', status: 'ok' }];
  const { toFire, nextAnchor } = Scheduler.plan(STD, logs, now);
  console.assert(toFire.length === 0, `already fired, no catch-up, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w3', `next w3, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan skip-already-fired passed');
}

function testSkippedLogCountsAsDone() {
  const now = new Date(2026, 5, 15, 11, 0, 0);
  const logs = [{ anchor: 'w2', timestamp: '2026-06-15 10:30:00', status: 'skipped' }];
  const { toFire } = Scheduler.plan(STD, logs, now);
  console.assert(toFire.length === 0, `skipped counts as done, got ${JSON.stringify(toFire)}`);
  console.log('✓ Scheduler.plan skipped-counts-as-done passed');
}

function testRollsToTomorrowWhenDone() {
  const cfg = { startTime: '05:00', windowCount: 2, windowDuration: 1 }; // 5-6, 6-7
  const now = new Date(2026, 5, 15, 8, 0, 0); // 08:00 → both expired, none active/future
  const { toFire, nextAnchor, nextFireAt } = Scheduler.plan(cfg, [], now);
  console.assert(toFire.length === 0, `nothing to fire, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w1', `next w1, got ${nextAnchor}`);
  console.assert(nextFireAt.getDate() === 16, `fires tomorrow (16th), got ${nextFireAt.getDate()}`);
  console.assert(nextFireAt.getHours() === 5, `fires at 05:00, got ${nextFireAt.getHours()}`);
  console.log('✓ Scheduler.plan rolls-to-tomorrow passed');
}

testNextIsW1WhenBeforeStart();
testCatchUpActiveWindow();
testNoCatchUpWhenAlreadyFired();
testSkippedLogCountsAsDone();
testRollsToTomorrowWhenDone();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/Scheduler.test.js`
Expected: FAIL — `Cannot find module '../src/services/Scheduler'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/Scheduler.js`:

```js
const StatusService = require('./StatusService');
const LogReader = require('./LogReader');

class Scheduler {
  constructor(configManager, anchorRunner, options = {}) {
    this.configManager = configManager;
    this.anchorRunner = anchorRunner;
    this.logReader = options.logReader || new LogReader();
    this.onUpdate = options.onUpdate || (() => {});
    this._now = options.now || (() => new Date());
    this.timer = null;
    this.lastResult = null;
    this.nextFireAt = null;
    this.nextAnchor = null;
  }

  // Pure: decide which anchors to fire now (catch-up) and when the next
  // timer should fire. Reuses StatusService.getWindowTimes for window math.
  static plan(config, logs, now) {
    const windows = StatusService.getWindowTimes(config);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    const isDone = (anchor, startMin, endMin) =>
      (logs || []).some((l) => {
        if (l.anchor !== anchor) return false;
        if (!String(l.timestamp).startsWith(todayStr)) return false;
        const tp = String(l.timestamp).split(' ')[1];
        if (!tp) return false;
        const [lh, lm] = tp.split(':').map(Number);
        const lmin = lh * 60 + lm;
        return lmin >= startMin && lmin < endMin && (l.status === 'ok' || l.status === 'skipped');
      });

    const toFire = [];
    let nextFireAt = null;
    let nextAnchor = null;

    for (const w of windows) {
      const done = isDone(w.anchor, w.startMinutes, w.endMinutes);
      const isActive = nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes;
      const isFuture = w.startMinutes > nowMinutes;
      if (isActive && !done) toFire.push(w.anchor);
      if (isFuture && nextFireAt === null) {
        nextFireAt = Scheduler._dateAtMinutes(now, w.startMinutes, 0);
        nextAnchor = w.anchor;
      }
    }

    if (nextFireAt === null && windows.length > 0) {
      nextFireAt = Scheduler._dateAtMinutes(now, windows[0].startMinutes, 1);
      nextAnchor = windows[0].anchor;
    }

    return { toFire, nextFireAt, nextAnchor };
  }

  // Build a Date at (midnight + minutes), addDays days from `now`.
  // setHours normalizes minute values > 59 (and > 1440) into later hours/days.
  static _dateAtMinutes(now, minutes, addDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + (addDays || 0));
    d.setHours(0, minutes, 0, 0);
    return d;
  }

  start() {
    return this.recompute();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Serialized: concurrent callers (startup + apply-config + resume) chain so
  // two recomputes never run at once, preventing a double catch-up fire before
  // the first fire's log is written.
  recompute() {
    this._chain = (this._chain || Promise.resolve())
      .then(() => this._doRecompute())
      .catch((err) => console.error('Scheduler recompute error:', err));
    return this._chain;
  }

  async _doRecompute() {
    this.stop();
    const config = this.configManager.load();
    if (config.isPaused) {
      this.nextFireAt = null;
      this.nextAnchor = null;
      this.onUpdate(this.status());
      return;
    }
    const logs = this.logReader.getAllLogs();
    const { toFire, nextFireAt, nextAnchor } = Scheduler.plan(config, logs, this._now());
    for (const anchor of toFire) {
      const res = await this.anchorRunner.fire(anchor);
      this.lastResult = { anchor, ok: res.ok, time: this._now() };
    }
    this._arm(nextFireAt, nextAnchor);
    this.onUpdate(this.status());
  }

  _arm(nextFireAt, nextAnchor) {
    this.stop();
    this.nextFireAt = nextFireAt;
    this.nextAnchor = nextAnchor;
    if (!nextFireAt) return;
    let delay = nextFireAt.getTime() - this._now().getTime();
    if (delay < 0) delay = 0;
    this.timer = setTimeout(() => this._onTimer(nextAnchor), delay);
  }

  async _onTimer(anchor) {
    const res = await this.anchorRunner.fire(anchor);
    this.lastResult = { anchor, ok: res.ok, time: this._now() };
    this.onUpdate(this.status());
    await this.recompute();
  }

  async fireNow(anchor) {
    const res = await this.anchorRunner.fire(anchor);
    this.lastResult = { anchor, ok: res.ok, time: this._now() };
    this.onUpdate(this.status());
    return res;
  }

  status() {
    return {
      nextFireAt: this.nextFireAt,
      nextAnchor: this.nextAnchor,
      lastResult: this.lastResult,
      paused: Boolean(this.configManager.load().isPaused)
    };
  }
}

module.exports = Scheduler;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/Scheduler.test.js`
Expected: five `✓` lines, no `Assertion failed` output.

- [ ] **Step 5: Add an instance-level recompute test (fakes, no real timers/claude)**

Append to `tests/Scheduler.test.js`:

```js
async function testRecomputeFiresCatchUpAndArms() {
  const fired = [];
  const fakeRunner = { fire: (a) => { fired.push(a); return Promise.resolve({ ok: true, reply: 'OK' }); } };
  const fakeConfig = { load: () => ({ startTime: '05:00', windowCount: 4, windowDuration: 5, isPaused: false }) };
  const fakeLogs = { getAllLogs: () => [] };
  const fixedNow = () => new Date(2026, 5, 15, 11, 0, 0); // inside w2
  const s = new Scheduler(fakeConfig, fakeRunner, { logReader: fakeLogs, now: fixedNow });
  await s.recompute();
  console.assert(fired.length === 1 && fired[0] === 'w2', `recompute fires w2, got ${JSON.stringify(fired)}`);
  console.assert(s.timer !== null, 'recompute arms a timer');
  console.assert(s.nextAnchor === 'w3', `armed for w3, got ${s.nextAnchor}`);
  s.stop();
  console.log('✓ Scheduler.recompute catch-up + arm passed');
}

async function testRecomputePausedDoesNothing() {
  const fired = [];
  const fakeRunner = { fire: (a) => { fired.push(a); return Promise.resolve({ ok: true }); } };
  const fakeConfig = { load: () => ({ startTime: '05:00', windowCount: 4, windowDuration: 5, isPaused: true }) };
  const fakeLogs = { getAllLogs: () => [] };
  const s = new Scheduler(fakeConfig, fakeRunner, { logReader: fakeLogs, now: () => new Date(2026, 5, 15, 11, 0, 0) });
  await s.recompute();
  console.assert(fired.length === 0, `paused fires nothing, got ${JSON.stringify(fired)}`);
  console.assert(s.timer === null, 'paused arms no timer');
  console.log('✓ Scheduler.recompute paused passed');
}

testRecomputeFiresCatchUpAndArms();
testRecomputePausedDoesNothing();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node tests/Scheduler.test.js`
Expected: seven `✓` lines total, no `Assertion failed` output.

- [ ] **Step 7: Commit**

```bash
git add src/services/Scheduler.js tests/Scheduler.test.js
git commit -m "feat: Scheduler — pure plan() core + in-process timer shell"
```

---

## Task 3: Rewrite main.js — wire Scheduler, hidden tray, single-instance, powerMonitor

**Files:**
- Modify (full replace): `electron/main.js`

This wires the new services, starts hidden to tray, adds a single-instance lock and `powerMonitor` resume handling, keeps every existing IPC channel name (routing to the Scheduler), and runs a hidden one-time self-sweep of any leftover `ClaudeAnchor-w*` tasks on startup.

- [ ] **Step 1: Replace `electron/main.js` with the new version**

```js
const { app, BrowserWindow, Menu, ipcMain, powerMonitor } = require('electron');
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

// One-time hidden sweep of leftover app-created tasks (safety net). Runs via
// execFile with windowsHide:true → no console window. The legacy S4U tasks are
// removed separately by Remove-AnchorTasks.ps1 (needs elevation).
function sweepLeftoverTasks() {
  if (process.platform !== 'win32') return;
  const psScript = [
    "$valid=@('ClaudeAnchor-w1','ClaudeAnchor-w2','ClaudeAnchor-w3','ClaudeAnchor-w4')",
    "Get-ScheduledTask | Where-Object { $_.TaskName -like 'ClaudeAnchor-*' } | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue }"
  ].join('; ');
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
ipcMain.handle('fire-anchor', (event, anchor) => {
  try { return scheduler.fireNow(anchor); }
  catch (err) { console.error('IPC fire-anchor:', err); return false; }
});

ipcMain.handle('detect-window-duration', () => windowDetector.detect(configManager));

ipcMain.on('pause-all', () => { scheduler.stop(); updateTrayStatus(scheduler.status()); });
ipcMain.on('resume-all', () => { scheduler.recompute(); });

ipcMain.handle('apply-config', () => {
  try { return scheduler.recompute(); }
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
    { label: 'Fire Now', click: () => {
        const active = StatusService.getActiveWindow(configManager.load());
        if (active) scheduler.fireNow(active.anchor);
    } },
    { label: 'Pause', click: () => { scheduler.stop(); updateTrayStatus(scheduler.status()); } },
    { label: 'Resume', click: () => scheduler.recompute() },
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
  windowDetector.detect(configManager).catch((err) =>
    console.error('WindowDetector error on startup:', err));
  scheduler.start().catch((err) => console.error('Scheduler start error:', err));
  powerMonitor.on('resume', () => {
    scheduler.recompute().catch((err) => console.error('Scheduler resume error:', err));
  });
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('before-quit', () => { app.quitting = true; });
```

- [ ] **Step 2: Verify the app boots, stays hidden, and arms a timer**

Run: `npm start`
Expected:
- No window appears on launch (tray icon only). Clicking the tray icon shows the dashboard.
- DevTools console (open via tray → Show, it auto-opens in dev) shows no `Scheduler start error` / `WindowDetector` crash.
- Hovering the tray icon shows a tooltip like `Claude Anchors — next w? at HH:MM` (or `— Paused` if paused).
- Quit via the tray menu.

- [ ] **Step 3: Verify no scheduled tasks were created**

Run: `powershell.exe -NoProfile -Command "Get-ScheduledTask | Where-Object { $_.TaskName -like 'ClaudeAnchor-*' } | Select-Object TaskName"`
Expected: no rows (the app creates none and self-swept any leftovers).

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: main.js — in-process Scheduler, hidden tray, single-instance, powerMonitor"
```

---

## Task 4: Delete TaskManager and all runner scripts

**Files:**
- Delete: `src/services/TaskManager.js`
- Delete: `scripts/anchor-runner.ps1`, `scripts/anchor-runner.sh`
- Delete: `scripts/W1-Primary.ps1`, `W1-Backup.ps1`, `W2-Primary.ps1`, `W2-Backup.ps1`, `W3-Primary.ps1`, `W3-Backup.ps1`, `W4-Primary.ps1`, `W4-Backup.ps1`

- [ ] **Step 1: Confirm nothing still imports the deleted code**

Run: `git grep -n "TaskManager\|anchor-runner\|W1-Primary" -- "*.js"`
Expected: no matches outside `docs/`. (main.js no longer requires TaskManager after Task 3.) If any match appears in a `.js` file, fix it before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/services/TaskManager.js \
  scripts/anchor-runner.ps1 scripts/anchor-runner.sh \
  scripts/W1-Primary.ps1 scripts/W1-Backup.ps1 \
  scripts/W2-Primary.ps1 scripts/W2-Backup.ps1 \
  scripts/W3-Primary.ps1 scripts/W3-Backup.ps1 \
  scripts/W4-Primary.ps1 scripts/W4-Backup.ps1
```

- [ ] **Step 3: Verify the app still boots**

Run: `npm start`
Expected: app launches hidden to tray, no `Cannot find module` errors in the DevTools console. Quit via tray.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: delete TaskManager and all OS-task runner scripts"
```

---

## Task 5: One-time elevated cleanup script

**Files:**
- Create: `Remove-AnchorTasks.ps1`

Removes **both** task generations in one elevated run: the app's `ClaudeAnchor-*` (root, Interactive) and the legacy `\ClaudeAnchors\W*-Primary/Backup` (S4U/Highest).

- [ ] **Step 1: Create `Remove-AnchorTasks.ps1`**

```powershell
# Remove ALL Claude Anchors scheduled tasks (both generations).
# Run once, elevated:  powershell -ExecutionPolicy Bypass -File .\Remove-AnchorTasks.ps1
# The redesigned tray app creates zero tasks, so this is a one-time cleanup.

$ErrorActionPreference = 'Continue'
$removed = @()
$failed = @()

$targets = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  $_.TaskName -like 'ClaudeAnchor-*' -or
  ($_.TaskPath -like '\ClaudeAnchors\*') -or
  ($_.TaskName -match '^W[1-4]-(Primary|Backup)$')
}

foreach ($t in $targets) {
  $full = "$($t.TaskPath)$($t.TaskName)"
  try {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop
    $removed += $full
  } catch {
    $failed += "${full}: $($_.Exception.Message)"
  }
}

Write-Output "Removed $($removed.Count) task(s):"
$removed | ForEach-Object { Write-Output "  $_" }
if ($failed.Count -gt 0) {
  Write-Output "Failed ($($failed.Count)):"
  $failed | ForEach-Object { Write-Output "  $_" }
}
```

- [ ] **Step 2: Lint the script for syntax (no execution)**

Run: `powershell.exe -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw .\Remove-AnchorTasks.ps1), [ref]$null); 'syntax ok'"`
Expected: prints `syntax ok` (no parser errors).

- [ ] **Step 3: Commit**

```bash
git add Remove-AnchorTasks.ps1
git commit -m "feat: one-time elevated sweep to remove all anchor scheduled tasks"
```

> **Manual step (done by the user, not the executor):** run `Remove-AnchorTasks.ps1` once from an **elevated** PowerShell to delete the existing tasks. Then reboot to confirm zero popups.

---

## Task 6: package.json — add test script, drop unused dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm `node-schedule` is unused**

Run: `git grep -n "node-schedule" -- "*.js"`
Expected: no matches (only possibly in package files). If a `.js` file uses it, skip the removal in Step 2.

- [ ] **Step 2: Edit `package.json`**

Add a `test` script and remove the `node-schedule` dependency. The `scripts` and `dependencies` sections become:

```json
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "test": "node tests/ConfigManager.test.js && node tests/StatusService.test.js && node tests/Scheduler.test.js && node tests/AnchorRunner.test.js",
    "build": "electron-builder",
    "build-win": "electron-builder --win",
    "build-mac": "electron-builder --mac",
    "dist": "electron-builder -mwl"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.6.4"
  },
  "dependencies": {}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all `✓` lines from ConfigManager, StatusService, Scheduler, and AnchorRunner suites; no `Assertion failed` output.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add test script, remove unused node-schedule dependency"
```

---

## Verification (whole feature)

- [ ] `npm test` → all suites pass.
- [ ] `npm start` → app launches hidden to tray (no window, no taskbar entry); tray tooltip shows the next fire time.
- [ ] Tray → Fire Now during an active window → a new `OK` entry appears in `~/.claude-anchors/logs/w?.log` and the Logs view; **no console window flashes**.
- [ ] `Get-ScheduledTask | ? TaskName -like 'ClaudeAnchor-*'` → empty.
- [ ] After running `Remove-AnchorTasks.ps1` elevated + reboot → no popup windows at login.

---

## Out of Scope

- `Fleet-Watchdog` / `FathomHourlyTranscripts` (separate projects) — handled outside this plan.
- Native macOS launchd scheduling (replaced by the cross-platform in-process timer).
- Next-day-wrapping windows where a window's start computes past midnight: classification mirrors the existing `StatusService` minute-based logic (unchanged limitation); `Scheduler._dateAtMinutes` normalizes correctly for arming.
