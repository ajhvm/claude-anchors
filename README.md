# claude-anchors

Windows Task Scheduler tasks that anchor [Claude's 5-hour usage windows](https://support.anthropic.com/en/articles/9797557-usage-limits) to fixed daily work blocks.

Each anchor fires a tiny `claude -p` call at a scheduled time, which opens a fresh 5-hour window the moment it fires. A backup task fires 15 minutes later to catch edge cases where a primary lands inside the previous window.

## Schedule

| Block | Primary | Backup |
|-------|---------|--------|
| 5 am – 10 am  | 4:55 AM  | 5:10 AM  |
| 10 am – 3 pm  | 10:01 AM | 10:15 AM |
| 3 pm – 8 pm   | 3:05 PM  | 3:20 PM  |
| 8 pm – 1 am   | 8:10 PM  | 8:25 PM  |

## Requirements

- Windows 10/11
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (`npm install -g @anthropic-ai/claude-code`) with an active subscription
- PowerShell 5.1+

## Installation

Open PowerShell (no elevation needed for the basic install):

```powershell
git clone https://github.com/ajhvm/claude-anchors.git "$env:USERPROFILE\ClaudeAnchors"
cd "$env:USERPROFILE\ClaudeAnchors"
.\Install.ps1
```

To also get **run-without-login** (S4U logon, tasks grouped under a `\ClaudeAnchors\` folder), run once as administrator after the basic install:

```powershell
Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File '$env:USERPROFILE\ClaudeAnchors\Elevate-ClaudeAnchors.ps1'"
```

## What Install.ps1 does

1. Creates `%USERPROFILE%\ClaudeAnchors\logs\`
2. Auto-discovers the `claude` executable on `PATH` (falls back to the npm global path)
3. Registers 8 daily tasks in Task Scheduler with:
   - WakeToRun (wakes the machine from sleep)
   - StartWhenAvailable (runs on next login if missed)
   - Retry 3× at 1-minute intervals on failure
   - IgnoreNew if an instance is already running
   - stdout + stderr appended to `logs\<task-name>.log`

## Logs

Each task appends to its own file:

```
%USERPROFILE%\ClaudeAnchors\logs\W1-Primary.log
%USERPROFILE%\ClaudeAnchors\logs\W3-Backup.log
...
```

A successful entry looks like:

```
=== 2026-05-19 12:15:37 ===
OK
```

## Managing tasks

```powershell
# Disable a single task
Disable-ScheduledTask -TaskName "ClaudeAnchor-W3-Primary"

# Re-enable
Enable-ScheduledTask -TaskName "ClaudeAnchor-W3-Primary"

# Remove all 8 tasks
"W1-Primary","W2-Primary","W3-Primary","W4-Primary","W1-Backup","W2-Backup","W3-Backup","W4-Backup" |
    ForEach-Object { Unregister-ScheduledTask -TaskName "ClaudeAnchor-$_" -Confirm:$false }
```

**Edit prompts or paths:** open `scripts\<task-name>.ps1` and change `$prompt` or `$claudePath`. No re-registration needed — Task Scheduler re-reads the script on every run.

**Change the schedule:** `taskschd.msc` → find the task → Triggers tab, or use `Set-ScheduledTask`.

## File layout

```
ClaudeAnchors/
├── Install.ps1                  # one-shot setup (no elevation)
├── Elevate-ClaudeAnchors.ps1    # optional: S4U + folder grouping (needs admin)
├── scripts/
│   ├── W1-Primary.ps1
│   ├── W1-Backup.ps1
│   ├── W2-Primary.ps1
│   ├── W2-Backup.ps1
│   ├── W3-Primary.ps1
│   ├── W3-Backup.ps1
│   ├── W4-Primary.ps1
│   └── W4-Backup.ps1
└── logs/                        # gitignored — created at install time
```
