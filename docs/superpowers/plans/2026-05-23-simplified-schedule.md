# Simplified Schedule Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the complex 7×8 per-day anchor schedule with a simple global schedule: one start time, 2–4 auto-spaced windows, duration auto-detected via `claude -p`.

**Architecture:** Config v2 is a flat schema (`startTime`, `windowCount`, `windowDuration`); all window times are derived at runtime. Runner scripts accept `scheduledTime` and do an expiry check instead of relying on backup anchors. Legacy Task Scheduler tasks are swept on startup and settings save.

**Tech Stack:** Electron 28, Node.js child_process, Windows Task Scheduler via PowerShell execFile, macOS launchd plist, `claude -p` CLI for auto-detection.

---

## File Structure

| File | Change |
|------|--------|
| `src/services/ConfigManager.js` | v2 default config, `migrateV1toV2()`, updated `load()` |
| `src/services/WindowDetector.js` | **New** — auto-detect window duration via `claude -p` |
| `src/services/StatusService.js` | Full rewrite — static methods, dynamic window calculation |
| `src/services/LogReader.js` | Add SKIPPED status detection |
| `scripts/anchor-runner.ps1` | Add `-scheduledTime` param, read config, expiry check |
| `scripts/anchor-runner.sh` | Same as .ps1 |
| `src/services/TaskManager.js` | 4-anchor names, legacy cleanup, pass `scheduledTime` |
| `src/App.js` | New Status dashboard + new Settings UI (5 controls) |
| `electron/main.js` | WindowDetector + cleanup on startup; updated IPC |
| `tests/ConfigManager.test.js` | Update for v2 config structure |
| `tests/StatusService.test.js` | **New** — unit tests for static methods |

---

### Task 1: ConfigManager v2

**Files:**
- Modify: `src/services/ConfigManager.js`
- Modify: `tests/ConfigManager.test.js`

- [ ] **Step 1: Write failing tests**

Replace `tests/ConfigManager.test.js` with:

```javascript
const ConfigManager = require('../src/services/ConfigManager');

function testConfigLoad() {
  const cm = new ConfigManager();
  const config = cm.load();
  console.assert(config.version === 2, `Config is version 2, got: ${config.version}`);
  console.assert(config.startTime, 'Config has startTime');
  console.assert(typeof config.windowCount === 'number', 'Config has windowCount');
  console.assert(typeof config.windowDuration === 'number', 'Config has windowDuration');
  console.assert(config.windowDurationSource, 'Config has windowDurationSource');
  console.assert(typeof config.prompt === 'string', 'Config has prompt string');
  console.log('✓ Config load test passed');
}

function testConfigSave() {
  const cm = new ConfigManager();
  const original = cm.load();
  const testConfig = { ...original, timezone: 'America/New_York', _test: true };
  const saved = cm.save(testConfig);
  console.assert(saved, 'Config saved successfully');
  const loaded = cm.load();
  console.assert(loaded._test === true, 'Config persisted');
  cm.save(original);
  console.log('✓ Config save test passed');
}

function testMigrateV1toV2() {
  const cm = new ConfigManager();
  const original = cm.load();
  const v1 = {
    version: 1,
    timezone: 'America/Chicago',
    isPaused: false,
    schedule: { monday: { w1Primary: '06:00', w1Backup: '06:15' } },
    prompts: { w1Primary: 'Custom prompt.' }
  };
  const v2 = cm.migrateV1toV2(v1);
  console.assert(v2.version === 2, 'Migrated to version 2');
  console.assert(v2.startTime === '06:00', `startTime from w1Primary, got: ${v2.startTime}`);
  console.assert(v2.prompt === 'Custom prompt.', `prompt from w1Primary, got: ${v2.prompt}`);
  console.assert(v2.windowCount === 4, 'Default windowCount is 4');
  console.assert(!v2.schedule, 'No schedule in v2 config');
  cm.save(original);
  console.log('✓ migrateV1toV2 test passed');
}

testConfigLoad();
testConfigSave();
testMigrateV1toV2();
```

- [ ] **Step 2: Run test — verify it fails**

```
node tests/ConfigManager.test.js
```

Expected: AssertionError on `config.version === 2`

- [ ] **Step 3: Replace `src/services/ConfigManager.js`**

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.configDir = path.join(os.homedir(), '.claude-anchors');
    this.configFile = path.join(this.configDir, 'config.json');
    this.logsDir = path.join(this.configDir, 'logs');
    this.stateFile = path.join(this.configDir, 'state.json');

    this.ensureDirectories();
    this.defaultConfig = {
      version: 2,
      timezone: 'America/Los_Angeles',
      startTime: '05:00',
      windowCount: 4,
      windowDuration: 5,
      windowDurationSource: 'auto',
      isPaused: false,
      prompt: 'New context window open. Reply OK only.'
    };
  }

  ensureDirectories() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true });
  }

  migrateV1toV2(v1Config) {
    const startTime =
      (v1Config.schedule && v1Config.schedule.monday && v1Config.schedule.monday.w1Primary) ||
      '05:00';
    const prompt =
      (v1Config.prompts && v1Config.prompts.w1Primary) ||
      'New context window open. Reply OK only.';
    const v2Config = {
      version: 2,
      timezone: v1Config.timezone || 'America/Los_Angeles',
      startTime,
      windowCount: 4,
      windowDuration: 5,
      windowDurationSource: 'auto',
      isPaused: v1Config.isPaused || false,
      prompt
    };
    this.save(v2Config);
    return v2Config;
  }

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const config = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        if (!config.version || config.version < 2) return this.migrateV1toV2(config);
        return config;
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
    return { ...this.defaultConfig };
  }

  save(config) {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving config:', err);
      return false;
    }
  }

  getLogsDir() { return this.logsDir; }
  getConfigDir() { return this.configDir; }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile))
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
    } catch (err) {
      console.error('Error loading state:', err);
    }
    return { date: new Date().toISOString().split('T')[0], windowStartTime: null };
  }

  saveState(state) {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving state:', err);
      return false;
    }
  }
}

module.exports = ConfigManager;
```

- [ ] **Step 4: Run test — verify it passes**

```
node tests/ConfigManager.test.js
```

Expected: 3 lines starting with `✓`

- [ ] **Step 5: Commit**

```
git add src/services/ConfigManager.js tests/ConfigManager.test.js
git commit -m "feat: ConfigManager v2 — flat config with startTime/windowCount/windowDuration, v1 migration"
```

---

### Task 2: WindowDetector service

**Files:**
- Create: `src/services/WindowDetector.js`

- [ ] **Step 1: Create `src/services/WindowDetector.js`**

```javascript
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

class WindowDetector {
  detect(configManager) {
    return new Promise((resolve) => {
      const config = configManager.load();
      if (config.windowDurationSource !== 'auto') {
        resolve(false);
        return;
      }

      const isWindows = os.platform() === 'win32';
      const claude = isWindows
        ? path.join(process.env.APPDATA, 'npm', 'claude.cmd')
        : 'claude';

      const prompt = 'How many hours is the context window for my current Claude plan? Reply with only a single integer, nothing else.';

      execFile(claude, ['-p', prompt], { timeout: 30000 }, (err, stdout) => {
        if (err) {
          console.error('WindowDetector: detection failed:', err.message);
          resolve(false);
          return;
        }
        const hours = parseInt(stdout.trim(), 10);
        if (isNaN(hours) || hours < 1 || hours > 24) {
          console.error('WindowDetector: unexpected response:', JSON.stringify(stdout.trim()));
          resolve(false);
          return;
        }
        const updated = { ...configManager.load(), windowDuration: hours };
        configManager.save(updated);
        console.log(`WindowDetector: updated windowDuration to ${hours}h`);
        resolve(true);
      });
    });
  }
}

module.exports = WindowDetector;
```

- [ ] **Step 2: Verify graceful failure in Node REPL**

```javascript
const ConfigManager = require('./src/services/ConfigManager');
const WindowDetector = require('./src/services/WindowDetector');
const wd = new WindowDetector();
const cm = new ConfigManager();
wd.detect(cm).then(ok => console.log('resolved:', ok));
```

Expected: Either `resolved: true` (if claude found and returns integer) or `resolved: false` with a console.error — no crash.

- [ ] **Step 3: Commit**

```
git add src/services/WindowDetector.js
git commit -m "feat: WindowDetector — auto-detect window duration via claude -p"
```

---

### Task 3: StatusService rewrite + LogReader SKIPPED handling

**Files:**
- Rewrite: `src/services/StatusService.js`
- Modify: `src/services/LogReader.js`
- Create: `tests/StatusService.test.js`

- [ ] **Step 1: Create failing test `tests/StatusService.test.js`**

```javascript
const StatusService = require('../src/services/StatusService');

function testGetWindowTimes4() {
  const config = { startTime: '05:00', windowCount: 4, windowDuration: 5 };
  const windows = StatusService.getWindowTimes(config);
  console.assert(windows.length === 4, 'Returns 4 windows');
  console.assert(windows[0].anchor === 'w1', 'First anchor is w1');
  console.assert(windows[0].startHHMM === '05:00', `w1 starts at 05:00, got: ${windows[0].startHHMM}`);
  console.assert(windows[1].startHHMM === '10:00', `w2 starts at 10:00, got: ${windows[1].startHHMM}`);
  console.assert(windows[2].startHHMM === '15:00', `w3 starts at 15:00, got: ${windows[2].startHHMM}`);
  console.assert(windows[3].startHHMM === '20:00', `w4 starts at 20:00, got: ${windows[3].startHHMM}`);
  console.log('✓ getWindowTimes (4 windows) passed');
}

function testGetWindowTimes2() {
  const config = { startTime: '06:00', windowCount: 2, windowDuration: 6 };
  const windows = StatusService.getWindowTimes(config);
  console.assert(windows.length === 2, 'Returns 2 windows');
  console.assert(windows[0].startHHMM === '06:00', `w1=06:00, got: ${windows[0].startHHMM}`);
  console.assert(windows[1].startHHMM === '12:00', `w2=12:00, got: ${windows[1].startHHMM}`);
  console.log('✓ getWindowTimes (2 windows) passed');
}

function testGetWindowStatesNoLogs() {
  const config = { startTime: '01:00', windowCount: 2, windowDuration: 1 };
  const states = StatusService.getWindowStates(config, []);
  console.assert(states.length === 2, 'Returns 2 states');
  const valid = ['expired', 'active', 'pending', 'started', 'skipped'];
  states.forEach(s => console.assert(valid.includes(s.state), `Valid state: ${s.state}`));
  console.log('✓ getWindowStates (no logs) passed');
}

function testGetWindowStatesStarted() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const startH = String(Math.max(h - 1, 0)).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const startTime = `${startH}:${m}`;
  const config = { startTime, windowCount: 1, windowDuration: 2 };
  const fakeLog = {
    anchor: 'w1',
    timestamp: `${todayStr} ${startH}:${m}:00`,
    status: 'ok'
  };
  const states = StatusService.getWindowStates(config, [fakeLog]);
  console.assert(states[0].state === 'started', `Expected started, got: ${states[0].state}`);
  console.log('✓ getWindowStates (started) passed');
}

function testGetWindowStatesSkipped() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const startH = String(Math.max(h - 1, 0)).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const startTime = `${startH}:${m}`;
  const config = { startTime, windowCount: 1, windowDuration: 2 };
  const fakeLog = {
    anchor: 'w1',
    timestamp: `${todayStr} ${startH}:${m}:00`,
    status: 'skipped'
  };
  const states = StatusService.getWindowStates(config, [fakeLog]);
  console.assert(states[0].state === 'skipped', `Expected skipped, got: ${states[0].state}`);
  console.log('✓ getWindowStates (skipped) passed');
}

function testGetCountdown() {
  const config = { startTime: '23:59', windowCount: 1, windowDuration: 1 };
  const result = StatusService.getCountdown(config);
  console.assert(typeof result === 'string', 'Countdown is a string');
  console.log(`✓ getCountdown returned: "${result}"`);
}

testGetWindowTimes4();
testGetWindowTimes2();
testGetWindowStatesNoLogs();
testGetWindowStatesStarted();
testGetWindowStatesSkipped();
testGetCountdown();
```

- [ ] **Step 2: Run test — verify it fails**

```
node tests/StatusService.test.js
```

Expected: `TypeError: StatusService.getWindowTimes is not a function`

- [ ] **Step 3: Replace `src/services/StatusService.js`**

```javascript
class StatusService {
  static getWindowTimes(config) {
    const [startH, startM] = config.startTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const durationMinutes = config.windowDuration * 60;
    const windows = [];

    for (let i = 0; i < config.windowCount; i++) {
      const winStart = startMinutes + i * durationMinutes;
      const winEnd = winStart + durationMinutes;
      const sh = Math.floor(winStart / 60) % 24;
      const sm = winStart % 60;
      const eh = Math.floor(winEnd / 60) % 24;
      const em = winEnd % 60;

      const fmt12 = (h, m) => {
        const period = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')}${period}`;
      };

      windows.push({
        anchor: `w${i + 1}`,
        label: `Window ${i + 1}`,
        startMinutes: winStart,
        endMinutes: winEnd,
        startHHMM: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
        startStr: fmt12(sh, sm),
        endStr: fmt12(eh, em)
      });
    }

    return windows;
  }

  static getWindowStates(config, logs) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    return windows.map(win => {
      const windowLogs = (logs || []).filter(log => {
        if (log.anchor !== win.anchor) return false;
        if (!log.timestamp.startsWith(todayStr)) return false;
        const timePart = log.timestamp.split(' ')[1];
        if (!timePart) return false;
        const [lh, lm] = timePart.split(':').map(Number);
        const logMinutes = lh * 60 + lm;
        return logMinutes >= win.startMinutes && logMinutes < win.endMinutes;
      });

      const startedLog = windowLogs.find(l => l.status === 'ok');
      const hasSkipped = windowLogs.some(l => l.status === 'skipped');

      let state, detail;

      if (startedLog) {
        const timePart = startedLog.timestamp.split(' ')[1].slice(0, 5);
        const [h, m] = timePart.split(':').map(Number);
        const period = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 || 12;
        state = 'started';
        detail = `Started ${h12}:${String(m).padStart(2, '0')}${period}`;
      } else if (hasSkipped) {
        state = 'skipped';
        detail = 'Skipped';
      } else if (nowMinutes >= win.startMinutes && nowMinutes < win.endMinutes) {
        const remaining = win.endMinutes - nowMinutes;
        const rh = Math.floor(remaining / 60);
        const rm = remaining % 60;
        state = 'active';
        detail = rh > 0 ? `Active — ${rh}h ${rm}m remaining` : `Active — ${rm}m remaining`;
      } else if (win.startMinutes > nowMinutes) {
        const minsUntil = win.startMinutes - nowMinutes;
        const uh = Math.floor(minsUntil / 60);
        const um = minsUntil % 60;
        state = 'pending';
        detail = uh > 0 ? `Pending — fires in ${uh}h ${um}m` : `Pending — fires in ${um}m`;
      } else {
        state = 'expired';
        detail = 'Expired';
      }

      return { ...win, state, detail };
    });
  }

  static getCountdown(config) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const next = windows.find(w => w.startMinutes > nowMinutes);
    if (!next) return 'Done for today';
    const diff = next.startMinutes - nowMinutes;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  static getActiveWindow(config) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return windows.find(w => nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes) || null;
  }
}

if (typeof module !== 'undefined') module.exports = StatusService;
```

- [ ] **Step 4: Update `src/services/LogReader.js` — add SKIPPED detection**

In `parseLogFile`, find the block:

```javascript
      } else if (line.trim() === 'OK') {
        if (currentEntry) currentEntry.status = 'ok';
      } else if (line.trim().startsWith('ERROR')) {
        if (currentEntry) currentEntry.status = 'error';
      } else if (currentEntry && line.trim()) {
```

Replace with:

```javascript
      } else if (line.trim() === 'OK') {
        if (currentEntry) currentEntry.status = 'ok';
      } else if (line.trim().startsWith('SKIPPED')) {
        if (currentEntry) currentEntry.status = 'skipped';
      } else if (line.trim().startsWith('ERROR')) {
        if (currentEntry) currentEntry.status = 'error';
      } else if (currentEntry && line.trim()) {
```

- [ ] **Step 5: Run test — verify it passes**

```
node tests/StatusService.test.js
```

Expected: 6 lines starting with `✓`

- [ ] **Step 6: Commit**

```
git add src/services/StatusService.js src/services/LogReader.js tests/StatusService.test.js
git commit -m "feat: StatusService rewrite — dynamic window times, per-window states; LogReader handles SKIPPED"
```

---

### Task 4: Runner script updates

**Files:**
- Modify: `scripts/anchor-runner.ps1`
- Modify: `scripts/anchor-runner.sh`

- [ ] **Step 1: Replace `scripts/anchor-runner.ps1`**

```powershell
param(
  [string]$anchor,
  [string]$scheduledTime
)

$configFile = Join-Path $env:USERPROFILE ".claude-anchors\config.json"
$logDir = Join-Path $env:USERPROFILE ".claude-anchors\logs"
$logFile = Join-Path $logDir "$anchor.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$windowDuration = 5
$prompt = "New context window open. Reply OK only."
try {
  $config = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -ne $config.windowDuration) { $windowDuration = [int]$config.windowDuration }
  if ($config.prompt) { $prompt = $config.prompt }
} catch {
  Write-Error "Failed to read config: $_"
}

$today = Get-Date -Format "yyyy-MM-dd"
try {
  $windowStart = [datetime]::ParseExact("$today $scheduledTime", "yyyy-MM-dd HH:mm", $null)
  $windowEnd = $windowStart.AddHours($windowDuration)
  if ((Get-Date) -gt $windowEnd) {
    "=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
    "SKIPPED: Window expired" | Out-File -FilePath $logFile -Append -Encoding UTF8
    "" | Out-File -FilePath $logFile -Append -Encoding UTF8
    exit 0
  }
} catch {
  Write-Error "Failed to parse scheduledTime '$scheduledTime': $_"
}

"=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = "$env:APPDATA\npm\claude.cmd" }

& $claude -p "$prompt" 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
"" | Out-File -FilePath $logFile -Append -Encoding UTF8
```

- [ ] **Step 2: Replace `scripts/anchor-runner.sh`**

```bash
#!/bin/bash

ANCHOR=$1
SCHEDULED_TIME=$2

CONFIG_FILE="$HOME/.claude-anchors/config.json"
LOG_DIR="$HOME/.claude-anchors/logs"
LOG_FILE="$LOG_DIR/$ANCHOR.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

WINDOW_DURATION=5
PROMPT="New context window open. Reply OK only."
if [ -f "$CONFIG_FILE" ]; then
  WINDOW_DURATION=$(python3 -c "import json,sys; c=json.load(open('$CONFIG_FILE')); sys.stdout.write(str(c.get('windowDuration',5)))" 2>/dev/null || echo 5)
  PROMPT=$(python3 -c "import json,sys; c=json.load(open('$CONFIG_FILE')); sys.stdout.write(c.get('prompt','New context window open. Reply OK only.'))" 2>/dev/null || echo "New context window open. Reply OK only.")
fi

TODAY=$(date '+%Y-%m-%d')
if date --version 2>/dev/null | grep -q GNU; then
  WINDOW_END=$(date -d "$TODAY $SCHEDULED_TIME + $WINDOW_DURATION hours" '+%s')
else
  WINDOW_END=$(date -v+${WINDOW_DURATION}H -j -f "%Y-%m-%d %H:%M" "$TODAY $SCHEDULED_TIME" '+%s')
fi
NOW=$(date '+%s')

if [ "$NOW" -gt "$WINDOW_END" ]; then
  printf "=== %s ===\n" "$TIMESTAMP" >> "$LOG_FILE"
  printf "SKIPPED: Window expired\n\n" >> "$LOG_FILE"
  exit 0
fi

printf "=== %s ===\n" "$TIMESTAMP" >> "$LOG_FILE"
claude -p "$PROMPT" >> "$LOG_FILE" 2>&1
printf "\n" >> "$LOG_FILE"
```

- [ ] **Step 3: Test expiry check on Windows**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\anchor-runner.ps1" -anchor w1 -scheduledTime "00:00"
Get-Content "$env:USERPROFILE\.claude-anchors\logs\w1.log" -Tail 5
```

Expected: Log contains `SKIPPED: Window expired`

- [ ] **Step 4: Commit**

```
git add scripts/anchor-runner.ps1 scripts/anchor-runner.sh
git commit -m "feat: runner scripts — scheduledTime param, read config, expiry check"
```

---

### Task 5: TaskManager rewrite

**Files:**
- Modify: `src/services/TaskManager.js`

- [ ] **Step 1: Replace `src/services/TaskManager.js`**

```javascript
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

class TaskManager {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
  }

  computeWindowTimes(config) {
    const [startH, startM] = config.startTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const durationMinutes = config.windowDuration * 60;
    const windows = [];

    for (let i = 0; i < config.windowCount; i++) {
      const total = startMinutes + i * durationMinutes;
      const h = Math.floor(total / 60) % 24;
      const m = total % 60;
      windows.push({
        anchor: `w${i + 1}`,
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      });
    }

    return windows;
  }

  async fireAnchor(anchor, scheduledTime) {
    return new Promise((resolve) => {
      const scriptDir = path.join(__dirname, '../../scripts');
      const scriptName = this.isWindows ? 'anchor-runner.ps1' : 'anchor-runner.sh';
      const scriptPath = path.join(scriptDir, scriptName);

      if (this.isWindows) {
        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -anchor "${anchor}" -scheduledTime "${scheduledTime}"`;
        const child = spawn('cmd.exe', ['/c', cmd], { shell: true });
        child.on('close', () => resolve(true));
      } else {
        const child = spawn('bash', [scriptPath, anchor, scheduledTime]);
        child.on('close', () => resolve(true));
      }
    });
  }

  async registerTaskWindows(anchor, timeStr) {
    const scriptDir = path.join(__dirname, '../../scripts');
    const scriptPath = path.join(scriptDir, 'anchor-runner.ps1');
    const taskName = `ClaudeAnchor-${anchor}`;
    const [hour, minute] = timeStr.split(':').map(n => parseInt(n, 10));

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.error(`Invalid timeStr for ${anchor}: ${timeStr}`);
      return false;
    }

    const minutePad = String(minute).padStart(2, '0');
    const escapedPath = scriptPath.replace(/\\/g, '\\\\');
    const psScript = [
      `$trigger = New-ScheduledTaskTrigger -Daily -At '${hour}:${minutePad}'`,
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File \\"${escapedPath}\\" -anchor ${anchor} -scheduledTime ${timeStr}'`,
      `$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 0`,
      `Register-ScheduledTask -TaskName '${taskName}' -Trigger $trigger -Action $action -Settings $settings -Force`
    ].join('; ');

    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', psScript], (err) => {
        if (err) console.error(`Error registering ${taskName}:`, err.message);
        resolve(!err);
      });
    });
  }

  async cleanupLegacyTasksWindows() {
    const psScript = [
      `$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like 'ClaudeAnchor-*' }`,
      `$valid = @('ClaudeAnchor-w1','ClaudeAnchor-w2','ClaudeAnchor-w3','ClaudeAnchor-w4')`,
      `foreach ($task in $tasks) { if ($valid -notcontains $task.TaskName) { Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false } }`
    ].join('; ');

    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', psScript], (err) => {
        if (err) console.error('Error cleaning legacy tasks:', err.message);
        resolve(!err);
      });
    });
  }

  async updateTasksWindows(config) {
    await this.cleanupLegacyTasksWindows();
    const windows = this.computeWindowTimes(config);
    for (const win of windows) {
      await this.registerTaskWindows(win.anchor, win.timeStr);
    }
  }

  async pauseAllWindows() {
    const taskNames = ['ClaudeAnchor-w1', 'ClaudeAnchor-w2', 'ClaudeAnchor-w3', 'ClaudeAnchor-w4'];
    for (const taskName of taskNames) {
      execFile('powershell.exe', ['-NoProfile', '-Command', `Disable-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`], (err) => {
        if (err) console.error(`Error disabling ${taskName}:`, err.message);
      });
    }
  }

  async resumeAllWindows() {
    const taskNames = ['ClaudeAnchor-w1', 'ClaudeAnchor-w2', 'ClaudeAnchor-w3', 'ClaudeAnchor-w4'];
    for (const taskName of taskNames) {
      execFile('powershell.exe', ['-NoProfile', '-Command', `Enable-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`], (err) => {
        if (err) console.error(`Error enabling ${taskName}:`, err.message);
      });
    }
  }

  async registerTaskMacOS(anchor, timeStr) {
    const [hourStr, minuteStr] = timeStr.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.error(`Invalid timeStr for ${anchor}: ${timeStr}`);
      return false;
    }

    const fs = require('fs');
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const scriptPath = path.join(__dirname, '../../scripts/anchor-runner.sh');
    const plistName = `com.claudeanchors.${anchor}.plist`;
    const plistPath = path.join(launchAgentsDir, plistName);
    const logFile = path.join(os.homedir(), '.claude-anchors', 'logs', `${anchor}.log`);

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeanchors.${anchor}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${scriptPath}</string>
    <string>${anchor}</string>
    <string>${timeStr}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>`;

    try {
      if (!fs.existsSync(launchAgentsDir)) fs.mkdirSync(launchAgentsDir, { recursive: true });
      fs.writeFileSync(plistPath, plistContent, 'utf-8');
    } catch (err) {
      console.error(`Error writing plist for ${anchor}:`, err.message);
      return false;
    }

    return new Promise((resolve) => {
      execFile('launchctl', ['unload', plistPath], () => {
        execFile('launchctl', ['load', plistPath], (err) => {
          if (err) console.error(`Error loading ${plistName}:`, err.message);
          resolve(!err);
        });
      });
    });
  }

  async cleanupLegacyTasksMacOS() {
    const fs = require('fs');
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const validFiles = new Set([
      'com.claudeanchors.w1.plist', 'com.claudeanchors.w2.plist',
      'com.claudeanchors.w3.plist', 'com.claudeanchors.w4.plist'
    ]);

    try {
      if (!fs.existsSync(launchAgentsDir)) return;
      const files = fs.readdirSync(launchAgentsDir);
      for (const file of files) {
        if (!file.startsWith('com.claudeanchors.')) continue;
        if (validFiles.has(file)) continue;
        const plistPath = path.join(launchAgentsDir, file);
        await new Promise((resolve) => {
          execFile('launchctl', ['unload', plistPath], () => {
            try { fs.unlinkSync(plistPath); } catch {}
            resolve();
          });
        });
        console.log(`Removed legacy task: ${file}`);
      }
    } catch (err) {
      console.error('Error cleaning up legacy macOS tasks:', err.message);
    }
  }

  async updateTasksMacOS(config) {
    await this.cleanupLegacyTasksMacOS();
    const windows = this.computeWindowTimes(config);
    for (const win of windows) {
      await this.registerTaskMacOS(win.anchor, win.timeStr);
    }
  }

  async pauseAllMacOS() {
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    for (const anchor of ['w1', 'w2', 'w3', 'w4']) {
      const plistPath = path.join(launchAgentsDir, `com.claudeanchors.${anchor}.plist`);
      execFile('launchctl', ['unload', plistPath], (err) => {
        if (err) console.error(`Error unloading ${anchor}:`, err.message);
      });
    }
  }

  async resumeAllMacOS() {
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    for (const anchor of ['w1', 'w2', 'w3', 'w4']) {
      const plistPath = path.join(launchAgentsDir, `com.claudeanchors.${anchor}.plist`);
      execFile('launchctl', ['load', plistPath], (err) => {
        if (err) console.error(`Error loading ${anchor}:`, err.message);
      });
    }
  }

  async updateTasks(config) {
    if (this.isWindows) return this.updateTasksWindows(config);
    if (this.platform === 'darwin') return this.updateTasksMacOS(config);
  }

  async pauseAll() {
    if (this.isWindows) return this.pauseAllWindows();
    if (this.platform === 'darwin') return this.pauseAllMacOS();
  }

  async resumeAll() {
    if (this.isWindows) return this.resumeAllWindows();
    if (this.platform === 'darwin') return this.resumeAllMacOS();
  }

  async cleanupLegacyTasks() {
    if (this.isWindows) return this.cleanupLegacyTasksWindows();
    if (this.platform === 'darwin') return this.cleanupLegacyTasksMacOS();
  }
}

module.exports = TaskManager;
```

- [ ] **Step 2: Verify `computeWindowTimes` in Node REPL**

```
node -e "const T=require('./src/services/TaskManager'); const t=new T(); console.log(JSON.stringify(t.computeWindowTimes({startTime:'05:00',windowCount:4,windowDuration:5})))"
```

Expected:
```json
[{"anchor":"w1","timeStr":"05:00"},{"anchor":"w2","timeStr":"10:00"},{"anchor":"w3","timeStr":"15:00"},{"anchor":"w4","timeStr":"20:00"}]
```

- [ ] **Step 3: Commit**

```
git add src/services/TaskManager.js
git commit -m "feat: TaskManager — 4-anchor schedule, legacy cleanup, scheduledTime in scripts"
```

---

### Task 6: App.js Status view

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: Replace `renderStatusView()` in `src/App.js`**

Find and replace the entire `renderStatusView()` method:

```javascript
  renderStatusView() {
    if (!this.config || !this.config.startTime) {
      return `<h2>Status</h2><p style="color:#999;">Loading...</p>`;
    }
    setTimeout(() => this.loadStatusData(), 0);
    return `
      <h2>Status</h2>
      <div class="subtitle">Today's windows</div>
      <div id="window-states" style="margin:16px 0;">Loading...</div>
      <div style="margin-top:16px;">
        <button id="fire-now-btn" onclick="app.fireNow()">Fire Now</button>
        <button onclick="app.togglePause()" style="margin-left:8px;">
          ${this.config.isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>
    `;
  }
```

- [ ] **Step 2: Add `loadStatusData()` and `renderWindowStates()` after `renderStatusView()`**

```javascript
  async loadStatusData() {
    const el = document.getElementById('window-states');
    if (!el) return;
    try {
      const logs = await window.api.invoke('get-logs');
      const states = StatusService.getWindowStates(this.config, logs);
      el.innerHTML = this.renderWindowStates(states);
    } catch (err) {
      el.innerHTML = `<p style="color:#dc2626;">Error loading status: ${err.message}</p>`;
    }
  }

  renderWindowStates(states) {
    const icons = { started: '✓', active: '●', skipped: '⊘', pending: '○', expired: '—' };
    const colors = { started: '#16a34a', active: '#2563eb', skipped: '#9ca3af', pending: '#9ca3af', expired: '#d1d5db' };
    let html = '<table style="width:100%;border-collapse:collapse;">';
    states.forEach(win => {
      const icon = icons[win.state] || '?';
      const color = colors[win.state] || '#000';
      html += `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 8px;color:#6b7280;font-size:13px;">${win.label}</td>
        <td style="padding:10px 8px;font-size:12px;color:#9ca3af;">${win.startStr} – ${win.endStr}</td>
        <td style="padding:10px 8px;font-weight:bold;color:${color};">${icon} ${win.detail}</td>
      </tr>`;
    });
    html += '</table>';
    return html;
  }
```

- [ ] **Step 3: Replace `fireNow()` in `src/App.js`**

```javascript
  async fireNow() {
    const active = StatusService.getActiveWindow(this.config);
    if (!active) {
      alert('No active window right now');
      return;
    }
    alert(`Firing ${active.label}...`);
    await window.api.invoke('fire-anchor', active.anchor, active.startHHMM);
    alert('Anchor fired!');
    await this.loadStatusData();
  }
```

- [ ] **Step 4: Update `init()` — remove old StatusService usage, add periodic refresh**

Replace the existing `init()` method:

```javascript
  async init() {
    this.render();
    this.setupEventListeners();
    await this.loadConfig();

    try {
      await window.api.invoke('apply-config', this.config);
    } catch (err) {
      console.error('Error applying config on init:', err);
    }

    setInterval(() => {
      if (this.currentView === 'status') this.loadStatusData();
    }, 60000);
  }
```

- [ ] **Step 5: Start app and verify Status view**

```
npm start
```

Expected: Status view shows a table with 4 rows. Each row shows a window label, time range, and state (Started/Active/Skipped/Pending/Expired).

- [ ] **Step 6: Commit**

```
git add src/App.js
git commit -m "feat: status view — per-window state table with Started/Active/Skipped/Pending/Expired"
```

---

### Task 7: App.js Settings view

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: Replace `renderSettingsView()` in `src/App.js`**

```javascript
  renderSettingsView() {
    const cfg = this.config;
    const startTime = cfg.startTime || '05:00';
    const windowCount = cfg.windowCount || 4;
    const windowDuration = cfg.windowDuration || 5;
    const windowDurationSource = cfg.windowDurationSource || 'auto';
    const prompt = cfg.prompt || 'New context window open. Reply OK only.';
    const timezone = cfg.timezone || 'America/Los_Angeles';

    const radio = (val) => `
      <label style="margin-right:16px;">
        <input type="radio" name="window-count" value="${val}"
               ${windowCount === val ? 'checked' : ''}
               onchange="app.updateWindowTimesPreview()"> ${val}
      </label>`;

    const timezones = [
      'America/Los_Angeles', 'America/Denver', 'America/Chicago',
      'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'
    ];

    const previewText = this.getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration);

    return `
      <h2>Settings</h2>
      <div class="subtitle">Configure your schedule</div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Start Time</label>
        <input type="time" id="start-time" value="${startTime}"
               oninput="app.updateWindowTimesPreview()"
               style="padding:8px;font-size:14px;">
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Windows per day</label>
        ${radio(2)}${radio(3)}${radio(4)}
      </div>

      <div id="window-times-preview"
           style="margin:-12px 0 20px;color:#6b7280;font-size:13px;">${previewText}</div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Window Duration</label>
        <div style="color:#6b7280;font-size:13px;margin-bottom:8px;">
          ${windowDurationSource === 'auto' ? `Auto-detected: ${windowDuration}h` : `Manual: ${windowDuration}h`}
          <button onclick="app.redetectDuration()" style="margin-left:8px;font-size:12px;">Re-detect</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:13px;">Override:</span>
          <input type="number" id="duration-override" min="1" max="24"
                 value="${windowDurationSource === 'manual' ? windowDuration : ''}"
                 placeholder="hours" style="width:80px;padding:6px;">
          <button onclick="app.resetDurationToAuto()" style="font-size:12px;">Reset to auto</button>
        </div>
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Prompt</label>
        <textarea id="prompt" rows="3"
                  style="width:100%;padding:8px;font-family:monospace;font-size:12px;box-sizing:border-box;">${prompt}</textarea>
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Timezone</label>
        <select id="timezone" style="width:100%;padding:8px;">
          ${timezones.map(tz => `<option value="${tz}" ${tz === timezone ? 'selected' : ''}>${tz}</option>`).join('')}
        </select>
      </div>

      <button onclick="app.saveSettings()" style="margin-top:8px;">Save Settings</button>
    `;
  }
```

- [ ] **Step 2: Add helper and update methods to App class**

Add these methods to the App class (after `renderSettingsView`):

```javascript
  getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration) {
    const previewConfig = { startTime, windowCount, windowDuration };
    const windows = StatusService.getWindowTimes(previewConfig);
    return '→ ' + windows.map(w => w.startStr).join(' · ');
  }

  updateWindowTimesPreview() {
    const startTimeEl = document.getElementById('start-time');
    const windowCountEl = document.querySelector('input[name="window-count"]:checked');
    const startTime = startTimeEl ? startTimeEl.value : (this.config.startTime || '05:00');
    const windowCount = windowCountEl ? parseInt(windowCountEl.value) : (this.config.windowCount || 4);
    const windowDuration = this.config.windowDuration || 5;
    const previewEl = document.getElementById('window-times-preview');
    if (previewEl) previewEl.textContent = this.getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration);
  }

  async redetectDuration() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Detecting...';
    try {
      const updated = await window.api.invoke('detect-window-duration');
      if (updated) {
        this.config = await window.api.invoke('load-config');
        this.renderContent();
      } else {
        alert('Could not detect window duration. Check that claude is installed and authenticated.');
        btn.disabled = false;
        btn.textContent = 'Re-detect';
      }
    } catch (err) {
      alert('Detection failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Re-detect';
    }
  }

  async resetDurationToAuto() {
    this.config.windowDurationSource = 'auto';
    await window.api.invoke('save-config', this.config);
    this.renderContent();
  }
```

- [ ] **Step 3: Replace `saveSettings()` in `src/App.js`**

```javascript
  async saveSettings() {
    const startTime = document.getElementById('start-time').value;
    const windowCountEl = document.querySelector('input[name="window-count"]:checked');
    const windowCount = windowCountEl ? parseInt(windowCountEl.value) : this.config.windowCount;
    const durationOverride = document.getElementById('duration-override').value.trim();
    const timezone = document.getElementById('timezone').value;
    const prompt = document.getElementById('prompt').value;

    if (durationOverride) {
      const hours = parseInt(durationOverride, 10);
      if (isNaN(hours) || hours < 1 || hours > 24) {
        alert('Duration override must be a number between 1 and 24');
        return;
      }
      this.config.windowDuration = hours;
      this.config.windowDurationSource = 'manual';
    }

    this.config.startTime = startTime;
    this.config.windowCount = windowCount;
    this.config.timezone = timezone;
    this.config.prompt = prompt;

    const success = await window.api.invoke('save-config', this.config);
    if (success) {
      alert('Settings saved!');
      await window.api.invoke('apply-config', this.config);
    } else {
      alert('Error saving settings');
    }
  }
```

- [ ] **Step 4: Replace `loadConfig()` — remove v1 references**

```javascript
  async loadConfig() {
    try {
      this.config = await window.api.invoke('load-config');
      if (!this.config) throw new Error('No config returned');
    } catch (err) {
      console.error('Failed to load config:', err);
      alert('Error loading settings. Using defaults.');
      this.config = {
        version: 2,
        timezone: 'America/Los_Angeles',
        startTime: '05:00',
        windowCount: 4,
        windowDuration: 5,
        windowDurationSource: 'auto',
        isPaused: false,
        prompt: 'New context window open. Reply OK only.'
      };
    }
  }
```

- [ ] **Step 5: Verify Settings view in running app**

Click Settings in the sidebar. Verify:
- Start Time input shows current startTime
- Window count radio has 2/3/4 options with correct selection
- Preview line shows correct window times (e.g., `→ 5:00am · 10:00am · 3:00pm · 8:00pm`)
- Changing Start Time or window count radio updates preview
- Save Settings succeeds without errors

- [ ] **Step 6: Commit**

```
git add src/App.js
git commit -m "feat: settings view — 5 controls with live window-times preview"
```

---

### Task 8: main.js IPC updates

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: Replace `electron/main.js`**

```javascript
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

  taskManager.cleanupLegacyTasks().catch(err => {
    console.error('Error cleaning legacy tasks on startup:', err);
  });

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

  if (process.env.NODE_ENV !== 'production') {
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
```

- [ ] **Step 2: Commit**

```
git add electron/main.js
git commit -m "feat: main.js — WindowDetector + legacy cleanup on startup, detect-window-duration IPC"
```

---

### Task 9: Integration verification

- [ ] **Step 1: Run all unit tests**

```
node tests/ConfigManager.test.js && node tests/StatusService.test.js
```

Expected: All lines start with `✓`

- [ ] **Step 2: Launch app**

```
npm start
```

Expected: Electron window opens, Status view shows a table with 4 window rows.

- [ ] **Step 3: Verify Task Scheduler (Windows)**

Open Task Scheduler (`taskschd.msc`) and confirm:
- `ClaudeAnchor-w1` through `ClaudeAnchor-w4` are registered
- Each task has `StartWhenAvailable` enabled (check under Conditions tab)
- Any old `ClaudeAnchor-w1Primary`, `ClaudeAnchor-W1-Primary` tasks are gone

- [ ] **Step 4: Verify runner expiry check**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\anchor-runner.ps1" -anchor w1 -scheduledTime "00:00"
Get-Content "$env:USERPROFILE\.claude-anchors\logs\w1.log" -Tail 5
```

Expected: `SKIPPED: Window expired` in log

- [ ] **Step 5: Final commit**

```
git add -A
git commit -m "chore: v2 simplified schedule redesign complete"
```
