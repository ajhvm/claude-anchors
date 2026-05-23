# Claude Anchors — Simplified Schedule Redesign

**Date:** 2026-05-23  
**Status:** Approved  
**Author:** Claude + AJ

---

## Overview

Replace the complex per-day, 8-anchor scheduling system with a simple global schedule: one start time, a window count (2–4), and an auto-detected window duration. The app derives all window times automatically. Legacy scheduled tasks from previous versions are swept on startup.

---

## Config Structure (v2)

**Location:** `~/.claude-anchors/config.json`

```json
{
  "version": 2,
  "timezone": "America/Los_Angeles",
  "startTime": "05:00",
  "windowCount": 4,
  "windowDuration": 5,
  "windowDurationSource": "auto",
  "isPaused": false,
  "prompt": "New context window open. Reply OK only."
}
```

**Field definitions:**
- `startTime` — HH:MM (24h) when Window 1 fires each day
- `windowCount` — integer 2, 3, or 4 windows per day
- `windowDuration` — integer hours per window (auto-detected or manually set)
- `windowDurationSource` — `"auto"` (re-detect on next launch) or `"manual"` (user override)
- `prompt` — single prompt string sent to `claude -p` for all windows
- `isPaused` — disables all scheduled tasks without deleting them

**Derived window times** (runtime-only, never stored):  
`[startTime, startTime + windowDuration, startTime + 2*windowDuration, ...]`

Example: `startTime=05:00`, `windowCount=4`, `windowDuration=5`:  
→ `[5:00am, 10:00am, 3:00pm, 8:00pm]`

---

## Config Migration (v1 → v2)

When loading a config with `version: 1`, automatically migrate:
- `startTime` ← `schedule.monday.w1Primary` (or `"05:00"` fallback)
- `windowCount` ← `4`
- `windowDuration` ← `5`
- `windowDurationSource` ← `"auto"`
- `prompt` ← `prompts.w1Primary` (or default fallback)
- Drop `schedule`, `prompts`, `smartAdjustment` fields
- Set `version: 2`
- Save migrated config immediately

---

## Auto-Detection of Window Duration

On startup when `windowDurationSource === "auto"`, run in background (non-blocking):

```
claude -p "How many hours is the context window for my current Claude plan? Reply with only a single integer, nothing else."
```

- Parse integer from response
- On success: update `windowDuration`, keep `windowDurationSource: "auto"`, save config
- On failure (command not found, non-integer response, timeout): leave current `windowDuration` unchanged, log error, retry next launch

When user manually sets duration in Settings:
- Set `windowDurationSource: "manual"`
- Stop auto-detecting until user clicks "Reset to auto"

---

## Runner Script Behavior (Smart Start)

Both `anchor-runner.ps1` and `anchor-runner.sh` accept:
- `anchor` — window ID (`w1`, `w2`, `w3`, `w4`)
- `scheduledTime` — HH:MM of this window's scheduled start (e.g., `"05:00"`)

Scripts read `windowDuration` from `~/.claude-anchors/config.json` at runtime.

**Logic:**
1. Compute `windowEnd = today's scheduledTime + windowDuration hours`
2. If `now > windowEnd`: log `SKIPPED: Window expired`, exit 0
3. Otherwise: run `claude -p [prompt]`, log result

This replaces the backup anchor concept entirely. Windows Task Scheduler's `StartWhenAvailable` flag handles delayed starts (machine was sleeping) — the script's expiry check handles cases where the machine woke too late.

**Log format** (unchanged):
```
=== 2026-05-23 05:03:14 ===
OK

=== 2026-05-23 10:00:02 ===
SKIPPED: Window expired
```

---

## Task Registration

**Task names (v2):** `ClaudeAnchor-w1`, `ClaudeAnchor-w2`, `ClaudeAnchor-w3`, `ClaudeAnchor-w4`

Each task passes `-anchor w1 -scheduledTime 05:00` (or equivalent) to the runner script.

**Windows Task Scheduler settings:**
- Daily trigger at computed time
- `StartWhenAvailable: true` (runs on wake if machine was sleeping)
- `WakeToRun: true`
- `RestartCount: 0` (no retries — expiry check handles late starts)
- `MultipleInstances: IgnoreNew`

**macOS launchd:**  
Plist files at `~/Library/LaunchAgents/com.claudeanchors.w1.plist` through `.w4.plist`  
`StartCalendarInterval` with computed Hour/Minute.

---

## Legacy Task Cleanup

On startup and on every Settings save, the app:

1. **Windows:** Gets all scheduled tasks matching `ClaudeAnchor-*`, deletes any not in `{ClaudeAnchor-w1, ClaudeAnchor-w2, ClaudeAnchor-w3, ClaudeAnchor-w4}`
2. **macOS:** Removes any `~/Library/LaunchAgents/com.claudeanchors.*.plist` files not matching `com.claudeanchors.w1.plist` through `.w4.plist`

This sweeps:
- `ClaudeAnchor-W1-Primary`, `ClaudeAnchor-W1-Backup`, … (Install.ps1 legacy)
- `ClaudeAnchor-w1Primary`, `ClaudeAnchor-w1Backup`, … (Electron app v1)

---

## Status Dashboard

Shows all windows for today. Each window shows one of:

| State | Condition | Display |
|-------|-----------|---------|
| **Started** | Log entry exists within this window's timeframe | `✓ Started 5:03am` |
| **Active** | Currently within window timeframe, no log entry yet | `● Active — 2h 14m remaining` |
| **Skipped** | Log shows `SKIPPED` entry | `⊘ Skipped` |
| **Pending** | Scheduled in the future | `○ Pending — fires in 1h 46m` |
| **Expired** | Window passed, no log entry | `— Expired` |

"Fire Now" executes the currently active window's anchor immediately.

---

## Settings View

Replaces the 7×8 grid with 5 controls:

```
Start Time:        [05:00]
                   → Windows: 5:00am · 10:00am · 3:00pm · 8:00pm

Windows per day:   ○ 2   ○ 3   ● 4

Window Duration:   Auto-detected: 5h   [Re-detect]
                   Override: [  ] hours   (or [Reset to auto])

Prompt:            [                                               ]

Timezone:          [America/Los_Angeles ▼]

                   [ Save Settings ]
```

- Calculated window times update live as start time / window count / duration change
- "Re-detect" triggers a fresh `claude -p` duration query in background
- Pause/Resume stays on Status view only (removed from Settings)
- Smart Adjustment toggle removed entirely

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/ConfigManager.js` | v2 default config, v1→v2 migration |
| `src/services/StatusService.js` | Derive windows dynamically, new state logic |
| `src/services/TaskManager.js` | 4 tasks (w1–w4), legacy cleanup, pass scheduledTime to scripts |
| `src/services/WindowDetector.js` | New: auto-detect window duration via `claude -p` |
| `src/App.js` | New Settings UI, new Status dashboard |
| `scripts/anchor-runner.ps1` | Accept `scheduledTime`, read config, expiry check |
| `scripts/anchor-runner.sh` | Same as .ps1 |
| `tests/ConfigManager.test.js` | Update for v2 config structure |

---

## Out of Scope

- Per-day schedule overrides (e.g., weekends start at 8am) — add later if needed
- Per-window custom prompts — single prompt covers all windows
- Notifications when anchors fire
- Auto-update mechanism
