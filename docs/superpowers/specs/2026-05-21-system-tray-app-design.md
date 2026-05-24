# Claude Anchors System Tray App — Design Specification

**Date:** 2026-05-21  
**Status:** Design Phase  
**Author:** Claude + AJ

---

## Overview

A cross-platform (Windows/Mac) Electron-based system tray application that manages Claude Code usage window anchors. Replaces shell-script-based approach with a visual interface for configuration, monitoring, and advanced scheduling features.

**Core value:** Users can configure per-day anchor schedules, timezone, custom prompts, and enable smart window adjustment—all from a lightweight tray app that runs continuously in the background.

---

## Architecture

### Tech Stack
- **Framework:** Electron + Node.js
- **Backend:** Node.js + native OS APIs (Task Scheduler on Windows, launchd on macOS)
- **Frontend:** HTML/CSS/JS (Electron renderer)
- **Config storage:** Local JSON file (`~/.claude-anchors/config.json`)
- **Task management:** Native OS scheduling APIs (cross-platform abstraction layer)

### System Design

```
User GUI (Electron Window)
    ↓ (config changes)
App Backend (Node.js)
    ↓ (applies settings)
Task Scheduler / launchd
    ↓ (runs at scheduled time)
PowerShell / bash script
    ↓ (executes)
claude -p [message]
    ↓ (logs result)
Log file (~/.claude-anchors/logs/)
    ↓ (read back into app)
Status display in GUI
```

### Tray Behavior
- **Click tray icon:** Opens main app window
- **Close window (X button):** Minimizes to tray; app remains running
- **Right-click tray icon:** Context menu (Pause, Resume, View Logs, Quit)
- **Quit:** Disables all Task Scheduler/launchd tasks before exiting (ensures no orphaned processes)

---

## Features

### 1. Status Dashboard (Default View)
- **Current window display** — Shows active time block (e.g., "Window 1: 5am – 10am")
- **Countdown timer** — "Next anchor fires in 4h 32m"
- **Fire Now button** — Manually trigger the next scheduled anchor
- **Pause/Resume toggle** — Quick disable/enable all anchors without reconfiguring
- **Current profile info** — Displays active timezone and smart adjustment status

### 2. Settings Configuration
- **Timezone selector** — Dropdown with auto-detect + manual override
- **Per-day schedule grid** — 7 rows (Mon–Sun) × 4 columns (W1 Primary, W1 Backup, W2 Primary, W2 Backup, W3 Primary, W3 Backup, W4 Primary, W4 Backup)
  - Each cell: editable time input (HH:MM format, 24-hour)
  - Validation: No overlapping times, reasonable ranges (e.g., 4am–11pm)
- **Custom prompts** — Text input field for each anchor's message to `claude -p`
  - Default: "Window N open — [time] block. Reply OK only."
  - User can customize per-anchor
- **Smart adjustment toggle** — Enable/disable automatic window shifting on late runs
  - Label: "Auto-adjust remaining windows if an anchor runs late"
- **Save button** — Validates all inputs, updates config.json, syncs to Task Scheduler/launchd

### 3. Logs Viewer
- **Log list** — Chronological display of recent anchor runs
  - Columns: Timestamp, Anchor Name, Status (OK / Error), Duration
  - Newest first
- **Search/filter** — By date range, anchor name, status
- **Copy to clipboard** — Export selected entries for debugging
- **Auto-refresh** — Updates in real-time as tasks run

### 4. Window Size & Defaults
- **Initial size:** 600px wide × 700px tall (reasonable for sidebar layout)
- **Resizable:** Yes
- **Remember position/size:** Restore on next launch
- **Min size:** 500px × 500px (prevent squishing)

---

## Data Model

### Config File Structure
**Location:** `~/.claude-anchors/config.json` (expandable on Windows/Mac)

```json
{
  "version": 1,
  "timezone": "America/Los_Angeles",
  "smartAdjustment": true,
  "isPaused": false,
  "schedule": {
    "monday": {
      "w1Primary": "04:55",
      "w1Backup": "05:10",
      "w2Primary": "10:02",
      "w2Backup": "10:15",
      "w3Primary": "15:05",
      "w3Backup": "15:20",
      "w4Primary": "20:10",
      "w4Backup": "20:25"
    },
    "tuesday": { ... },
    "wednesday": { ... },
    "thursday": { ... },
    "friday": { ... },
    "saturday": { ... },
    "sunday": { ... }
  },
  "prompts": {
    "w1Primary": "Window 1 open — 5am block. Reply OK only.",
    "w1Backup": "Window 1 backup — 5am block. Reply OK only.",
    "w2Primary": "Window 2 open — 10am block. Reply OK only.",
    "w2Backup": "Window 2 backup — 10am block. Reply OK only.",
    "w3Primary": "Window 3 open — 3pm block. Reply OK only.",
    "w3Backup": "Window 3 backup — 3pm block. Reply OK only.",
    "w4Primary": "Window 4 open — 8pm block. Reply OK only.",
    "w4Backup": "Window 4 backup — 8pm block. Reply OK only."
  }
}
```

### Smart Adjustment State File
**Location:** `~/.claude-anchors/state.json` (cleared daily at midnight)

```json
{
  "date": "2026-05-21",
  "windowStartTime": "2026-05-21T05:30:00Z",
  "shifted": true
}
```

### Log File Structure
**Location:** `~/.claude-anchors/logs/` (separate file per anchor)

```
=== 2026-05-21 04:55:02 ===
OK

=== 2026-05-21 10:02:15 ===
OK

=== 2026-05-21 15:05:03 ===
ERROR: claude command not found
```

---

## Smart Window Adjustment Logic

**Trigger:** When an anchor task runs AND smart adjustment is enabled

**Detection:**
1. Task compares scheduled time vs actual run time
2. If difference > 15 seconds (configurable threshold), mark as "late"
3. Calculate actual window start: `actual_run_time - (scheduled_primary_time - window_open_time)`

**Adjustment:**
1. Write to state file: `windowStartTime = actual_start_time, shifted = true`
2. Each subsequent anchor that day:
   - Reads state file
   - If shifted, calculates adjusted fire time: `actual_window_start + (hours_since_window_open + 2 minutes)`
   - Reschedules itself in Task Scheduler/launchd
3. After W4-Backup runs, state file is cleared (ready for tomorrow's fixed 4:55am start)

**Reset:**
- **Primary:** Midnight (00:00) — App checks and clears state file automatically
- **Safety valve:** W4-Backup (or last scheduled anchor of day) also clears state if still active
- **Result:** Tomorrow always starts at configured W1-Primary time (not shifted). Even if user has a custom late schedule, state is cleared before next day's primary anchor fires.

---

## Task Scheduler / launchd Integration

### Windows (Task Scheduler)
- App creates 8 tasks per day (or per unique schedule if days differ)
- Tasks run PowerShell scripts with arguments: `claude.ps1 -anchor w1Primary -prompt "..."`
- Tasks include: WakeToRun, StartWhenAvailable, 3 retries at 1-minute intervals
- Pause: Disables all tasks; Resume: Enables them

### macOS (launchd)
- App creates 8 launchd plist files in `~/Library/LaunchAgents/`
- Each plist defines a daily scheduled job
- Pause: Unload agents; Resume: Load agents
- Smart adjustment: Rewrite plist with new time, reload agent

---

## Error Handling

### Task Execution Failures
- Log to `logs/[anchor-name].log` with timestamp and error message
- Display in Logs tab with red status indicator
- Auto-retry: Task Scheduler/launchd handles built-in retries
- User can "Fire Now" to manually retry

### Config Validation
- Timezone must be valid IANA identifier
- Times must be HH:MM in 24-hour format
- No two anchors on same day can have same time
- Times must be within reasonable bounds (4am–11pm for typical use)
- Error: Show dialog with validation message; don't save

### File Permissions
- Config file must be readable/writable by app
- Logs directory auto-created if missing
- If state file is stale (not today's date), auto-clear

---

## Distribution & Installation

### Windows
- Distributable as `.exe` installer or portable `.zip`
- Installer option: Creates Start Menu shortcut, sets up auto-launch on login (user consent)
- No admin privileges required (runs as current user)

### macOS
- Distributable as `.dmg` or `.zip`
- User drag-and-drop to Applications folder
- Auto-launch: Configurable via app UI (create launchd entry for app itself)

---

## Success Criteria

✅ User can configure per-day anchor times via GUI  
✅ Timezone selection works correctly  
✅ Custom prompts are used by `claude -p` tasks  
✅ Pause/Resume toggles all 8 tasks  
✅ Manual "Fire Now" executes anchor immediately  
✅ Logs display recent runs with status  
✅ Smart adjustment correctly shifts windows on late runs  
✅ State resets at midnight, ensuring tomorrow's scheduled time is fixed  
✅ App works on Windows and macOS with native scheduling  
✅ Settings persist across app restarts  

---

## Open Questions / Future Enhancements

- Retry threshold for smart adjustment (currently 15 seconds; configurable?)
- Should W4-Backup reset state file, or should midnight always do it?
- Notification when an anchor fires (tray notification vs silent)?
- Dark mode support?
- Update checker (auto-update mechanism)?

---

## Implementation Phases

1. **Phase 1:** Core app structure (Electron app, tray integration, basic settings UI)
2. **Phase 2:** Task Scheduler integration (Windows tasks creation/management)
3. **Phase 3:** launchd integration (macOS support)
4. **Phase 4:** Smart window adjustment logic
5. **Phase 5:** Logs viewer and polish
6. **Phase 6:** Testing, distribution, documentation
