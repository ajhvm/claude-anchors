# Claude Anchors — In-Process Scheduler Redesign

**Date:** 2026-05-24
**Status:** Approved
**Author:** Claude + AJ
**Supersedes scheduling sections of:** `2026-05-23-simplified-schedule-design.md`

---

## Problem

The app drives anchors through Windows Task Scheduler (`ClaudeAnchor-w1..4`) and, from
an earlier installer, an S4U set under `\ClaudeAnchors\` (`W1-Primary/Backup` … `W4`).
Tasks the app registers without elevation get **Interactive** logon — they run in the
user's desktop session and **flash a `powershell.exe` console window every time they
fire**. With `StartWhenAvailable`, every run missed while the PC was off fires on boot,
producing a burst of windows at login. `-WindowStyle Hidden` cannot prevent this: Windows
allocates the console window before PowerShell hides it.

The only way an OS task avoids the flash is S4U/session-0, which requires an admin/UAC
prompt at creation — unworkable for a daily auto-scheduler.

## Goal

Eliminate every OS scheduled task. The always-running tray app becomes the scheduler and
fires anchors **in-process** with `windowsHide: true`, so no console window can ever
appear. Popups become structurally impossible rather than merely hidden.

**Precondition (accepted):** the tray app must be running for anchors to fire. If the app
is not running, nothing fires. This is the trade that makes OS tasks unnecessary.

---

## Core Model

```
App running → timer armed for next window → fires `claude -p` hidden
            → logs result → updates tray → arms next window
```

No primary/backup pairs. No OS scheduled tasks. Each window fires at most once per day.
The "backup 15 minutes later" concept is removed entirely; a window-expiry check handles
late wakes.

---

## Components

### Scheduler (`src/services/Scheduler.js`) — new, runs in main process

Owns all timing. Holds at most one active `setTimeout` (the next window).

Responsibilities:
- **Compute today's windows** from config: `computeWindowTimes(config)` (moved here from
  TaskManager) returns `[{ anchor: 'w1', timeStr: '05:00' }, …]` for `windowCount` windows
  spaced `windowDuration` hours apart starting at `startTime`.
- **Classify each window** for today using the logs (via LogReader):
  - *fired* — a log entry exists within this window's timeframe today
  - *active* — `start ≤ now < start + windowDuration` and not yet fired
  - *expired* — `now ≥ start + windowDuration` and never fired
  - *future* — `now < start`
- **Catch-up on (re)start and on resume:** fire every *active* window that hasn't fired
  today, then arm the next *future* window.
- **Arm next:** single `setTimeout` to the next future window's start. On fire → run the
  anchor → re-classify → arm next. After the last window of the day → arm tomorrow's first
  window.
- **Re-arm triggers:** app start, config save, system resume (`powerMonitor`), pause→resume.
- **Pause:** clear the timer; do not fire. `isPaused` persists in config.

The Scheduler never spawns a shell for timing — timing is pure JS.

### AnchorRunner (`src/services/AnchorRunner.js`) — new

Fires a single anchor and records the result. Replaces `anchor-runner.ps1`,
`anchor-runner.sh`, and all `W*-Primary/Backup.ps1` scripts (deleted).

- Resolve the `claude` executable (PATH; Windows fallback `%APPDATA%\npm\claude.cmd`).
- Spawn `claude -p "<prompt>"` with `windowsHide: true`, capture stdout/stderr.
- Append to the per-window log `~/.claude-anchors/logs/<anchor>.log` in the existing
  format (`=== <timestamp> ===` then the reply or error).
- Resolve `{ ok: boolean, reply: string }`. `ok=false` when claude is missing, exits
  non-zero, times out, or returns no usable reply.
- Cross-platform: pure Node `child_process`, no `.ps1`/`.sh` runner.

### TaskManager — deleted

All OS-task code is removed: `registerTaskWindows`, `cleanupLegacyTasks*`, `pauseAll*`,
`resumeAll*`, `updateTasks*`, and the macOS launchd plist generation. `computeWindowTimes`
moves to the Scheduler. `fireAnchor` is superseded by AnchorRunner.

### Tray + main process (`electron/main.js`)

- **Start hidden to tray:** no window and no taskbar entry at login. The dashboard opens
  only when the user clicks the tray icon or chooses *Show*.
- **Tray menu:** Show · Fire Now · Pause/Resume · Quit.
- **Tray icon/tooltip state:** next fire time and last-fire status; a **red indicator on
  failure** of the most recent fire.
- **Single-instance lock:** `app.requestSingleInstanceLock()`; a second launch focuses the
  existing instance and exits, so timers never double-fire.
- Remove the startup `taskManager.updateTasks(config)` call; replace with
  `scheduler.start()`.
- Keep `WindowDetector` auto-detection of `windowDuration` on startup (unchanged).
- Wire `powerMonitor.on('resume', …)` → `scheduler.recompute()`.

### Status (`src/services/StatusService.js`, `src/App.js`)

Status reflects **scheduler state**, not task state. Keep the existing StatusService
labels (Started / Active / Skipped / Pending / Expired) derived from logs + computed
window times, and add "next fire in Hh Mm" and last-fire result. Remove any
task-existence checks from the status path. (Scheduler-internal classification uses
*fired/active/expired/future*; these map to the UI labels — *fired*→Started,
*expired-with-SKIPPED-log*→Skipped, *expired-no-log*→Expired.)

### One-time cleanup (`Remove-AnchorTasks.ps1`) — new, run elevated once

Removes **all** anchor OS tasks in a single elevated run (one UAC prompt):
- `ClaudeAnchor-w1..w4` and any `ClaudeAnchor-*` (root, Interactive)
- `\ClaudeAnchors\W1-Primary/Backup … W4-Primary/Backup` (S4U/Highest)

After this runs, the redesigned app creates zero tasks and never needs admin again. As a
non-elevated safety net, the app self-sweeps any stray `ClaudeAnchor-*` it can on startup.

---

## Data Flow

1. Login → app starts **hidden to tray** → acquire single-instance lock → load config →
   `WindowDetector.detect()` (background) → `scheduler.start()`.
2. `scheduler.start()` → compute today's windows → fire any *active*, unfired window
   (catch-up) → arm `setTimeout` for the next *future* window.
3. Timer fires → `AnchorRunner.fire(anchor)` (hidden) → append log → update tray (red on
   failure) → re-classify → arm next window (or tomorrow's first).
4. Config saved → `scheduler.recompute()` → re-arm.
5. System resume → `scheduler.recompute()` → catch-up if a window is still active → re-arm.
6. Pause → clear timer. Resume → `scheduler.recompute()` → arm.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| App closed at a window's time | Window missed; nothing fires. Next launch catches up only if still active. |
| Launch/wake mid-window, not fired | Fire now (catch-up). |
| Launch/wake after window expired | Skip; arm next. |
| Slept through a window | `powerMonitor` resume → recompute → catch-up if still active. |
| Last window of day fired | Arm tomorrow's first window. |
| `claude` missing or errors | Log failure, tray red indicator, no retry, arm next. |
| Second app instance launched | Single-instance lock focuses the running app and exits. |
| Clock/timezone | Window times computed in **local system time** (matching current runner behavior). The config `timezone` field is display-only; not used for computation in this revision. |

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/Scheduler.js` | **New** — timing, classification, catch-up, re-arm |
| `src/services/AnchorRunner.js` | **New** — fire `claude -p` hidden, log result |
| `src/services/TaskManager.js` | **Deleted** — all OS-task + launchd code removed |
| `scripts/anchor-runner.ps1`, `anchor-runner.sh`, `W1..W4-Primary/Backup.ps1` | **Deleted** |
| `electron/main.js` | Hidden tray launch, single-instance lock, wire Scheduler + powerMonitor, drop `updateTasks` |
| `src/services/StatusService.js` | Derive status from scheduler/logs, drop task-state checks |
| `src/App.js` | Status view reflects scheduler state; remove task-related UI |
| `electron/preload.js` | IPC for fire-now, pause/resume, get-status |
| `Remove-AnchorTasks.ps1` | **New** — one-time elevated sweep of all anchor tasks |
| `tests/Scheduler.test.js` | **New** — catch-up, next-window, day-rollover, expiry, pause |
| `tests/AnchorRunner.test.js` | **New** — success, claude-missing, non-zero exit, logging |
| `tests/ConfigManager.test.js`, `tests/StatusService.test.js` | Update for removed task paths |

---

## Out of Scope

- `Fleet-Watchdog` and `FathomHourlyTranscripts` scheduled tasks — separate projects;
  handled outside this spec (the every-5-minute `Fleet-Watchdog` is the worst remaining
  flasher and will be addressed in the same one-time admin session).
- Per-day or per-window custom schedules and prompts.
- Native macOS launchd scheduling (replaced by the cross-platform in-process timer).
- Anchor retries and notifications beyond the tray indicator.
