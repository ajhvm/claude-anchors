# Claude Anchors System Tray App — Implementation Progress

**Date Started:** 2026-05-21  
**Date Updated:** 2026-05-22  
**Status:** In Progress (4 of 12 tasks complete)  
**Current Branch:** worktree-system-tray-app  
**Working Directory:** `.claude/worktrees/system-tray-app`

---

## Completed Tasks ✅

### Task 1: Initialize Electron project structure
**Status:** DONE (Commit: ffe4be1)  
**Files Created:**
- `package.json` - Electron dependencies, build scripts
- `electron/main.js` - Main process with tray setup, window management
- `electron/preload.js` - Secure IPC bridge with contextBridge
- `electron/app.css` - Base styling for sidebar, content, buttons
- `src/App.js` - Main application class with view routing
- `src/index.html` - HTML entry point
- `.gitignore` - Project ignore rules

**Follow-up Commits:**
- `790bf46` - "fix: add icon fallback, disable DevTools in production, add window null checks"

**Status:** All code quality issues fixed. Ready for next task.

---

### Task 2: Implement ConfigManager service
**Status:** DONE (Commit: 4b4bb51)  
**Files Created:**
- `src/services/ConfigManager.js` - Config/state persistence with error handling

**Files Modified:**
- `electron/main.js` - Added ConfigManager init and 3 IPC handlers:
  - `load-config` - Loads config.json or returns defaults
  - `save-config` - Persists config to disk
  - `get-logs-dir` - Returns logs directory path

**Implementation Details:**
- Default config includes all 7 days × 8 anchors (w1Primary, w1Backup, w2Primary, w2Backup, w3Primary, w3Backup, w4Primary, w4Backup)
- All 8 anchor prompts defined
- Automatic directory creation for ~/.claude-anchors/
- State file management for window shifting
- Complete error handling on all file operations

---

### Task 3: Build Settings view with per-day scheduling
**Status:** DONE (Commit: 38fec28)  
**Files Modified:**
- `src/App.js` - Replaced renderSettingsView() and saveSettings()

**Implementation Details:**
- 7×8 scheduling grid (7 days of week × 8 anchors)
- Time input fields for each day/anchor combination (HH:MM format)
- Custom prompt textareas for each of 8 anchors
- Timezone selector (8 IANA timezone options)
- Smart Adjustment toggle checkbox
- Form validation and persistence via ConfigManager

---

### Task 4: Implement Status dashboard with countdown timer
**Status:** DONE (Commit: 1e3fbae)  
**Files Created:**
- `src/services/StatusService.js` - Status calculation and countdown service

**Files Modified:**
- `src/App.js` - Updated renderStatusView() and init()

**Implementation Details:**
- StatusService calculates current window based on today's schedule
- Countdown timer updates every 60 seconds
- Displays: current window (e.g., "Window 1: 5am – 10am"), time until next anchor
- Dynamic Pause/Resume button text based on config state
- "Fire Now" button ready for task execution
- Shows "Done for today" when no anchors remain

---

## Remaining Tasks ⏳

### Task 5: Create cross-platform task runner abstraction
**Status:** PENDING  
**Files to Create:**
- `src/services/TaskManager.js` - Cross-platform task execution service
- `scripts/anchor-runner.ps1` - PowerShell script for Windows
- `scripts/anchor-runner.sh` - Bash script for macOS

**Implementation Plan:**
- TaskManager detects platform (Windows, macOS, Linux)
- fireAnchor(anchor, prompt) executes platform-specific scripts
- Scripts parse anchor name and prompt, execute `claude -p [prompt]`
- Scripts log output to ~/.claude-anchors/logs/[anchor].log
- Stub methods for registerTask, updateTasks, pauseAll, resumeAll (completed in Tasks 8-9)
- Add IPC handler: `fire-anchor` for manual anchor execution

---

### Task 6: Build logs viewer with real-time updates
**Status:** PENDING  
**Files to Create:**
- `src/services/LogReader.js` - Parse and read log files

**Files to Modify:**
- `src/App.js` - Implement renderLogsView()
- `electron/main.js` - Add IPC handler: `get-logs`

**Implementation Plan:**
- LogReader parses log files from ~/.claude-anchors/logs/
- Extracts timestamp, anchor name, status (OK/ERROR), output
- Returns sorted list (newest first) with top 50 entries
- Logs view displays table: Timestamp | Anchor | Status
- Color-code status (green=OK, red=ERROR)

---

### Task 7: Implement pause/resume and smart window adjustment
**Status:** PENDING  
**Files to Create:**
- `src/services/SmartAdjustment.js` - Window shift tracking and reset logic

**Files to Modify:**
- `src/App.js` - Implement togglePause() method
- `electron/main.js` - Add handlers: `pause-all`, `resume-all`, `apply-config`

**Implementation Plan:**
- SmartAdjustment tracks state.json (date, windowStartTime, shifted flag)
- recordAnchorRun() detects late runs (>15s delay) and shifts remaining windows
- resetStateIfNewDay() clears state at midnight
- togglePause() updates config.isPaused and calls pause-all/resume-all
- Task 8-9 implement actual pause/resume in Task Scheduler/launchd

---

### Task 8: Implement Windows Task Scheduler integration
**Status:** PENDING  
**Files to Modify:**
- `src/services/TaskManager.js` - Add Windows-specific methods

**Implementation Plan:**
- registerTaskWindows(day, anchor, timeStr) - Create scheduled task via PowerShell
- updateTasksWindows(config) - Update all 8 tasks for current config
- pauseAllWindows() - Disable all ClaudeAnchor-* tasks
- resumeAllWindows() - Enable all ClaudeAnchor-* tasks
- Tasks created with names: ClaudeAnchor-w1Primary, ClaudeAnchor-w1Backup, etc.
- Each task runs anchor-runner.ps1 with anchor name and prompt
- Settings: WakeToRun, 3 retries at 1-minute intervals, IgnoreNew multiple instances

---

### Task 9: Implement macOS launchd integration
**Status:** PENDING  
**Files to Modify:**
- `src/services/TaskManager.js` - Add macOS-specific methods

**Implementation Plan:**
- registerTaskMacOS(day, anchor, timeStr) - Create launchd plist in ~/Library/LaunchAgents/
- updateTasksMacOS(config) - Create/update all 8 plist files
- pauseAllMacOS() - Run `launchctl unload` on all plist files
- resumeAllMacOS() - Run `launchctl load` on all plist files
- Plist files named: com.claudeanchors.[anchor].plist
- Each plist configures daily schedule with StartCalendarInterval
- RunScript executes anchor-runner.sh with anchor name and prompt

---

### Task 10: Add basic testing and error handling
**Status:** PENDING  
**Files to Create:**
- `tests/ConfigManager.test.js` - Unit tests for config operations

**Files to Modify:**
- `electron/main.js` - Add try/catch to all IPC handlers
- `src/App.js` - Add try/catch to loadConfig() and other async methods

**Implementation Plan:**
- Create two simple tests: testConfigLoad() and testConfigSave()
- Verify config can be loaded and persisted correctly
- Run: `node tests/ConfigManager.test.js` (expect 2 passing assertions)
- Add error handling to renderer IPC calls
- Show error alerts on config load/save failures

---

### Task 11: Complete app initialization and startup flow
**Status:** PENDING  
**Files to Modify:**
- `electron/main.js` - Add task initialization in createWindow()
- `src/App.js` - Add apply-config call in init()

**Implementation Plan:**
- createWindow() loads config and calls taskManager.updateTasks(config)
- init() applies config to system tasks on first load
- Test startup: `npm start`
- Verify: Electron app launches, shows Status view, countdown updates, tray visible
- All 8 tasks should be registered in Task Scheduler/launchd

---

### Task 12: Configure Electron Builder for distribution
**Status:** PENDING  
**Files to Create:**
- `electron-builder.json` - Build configuration for Windows/macOS
- `assets/icon.png` - Application icon (placeholder acceptable for now)

**Files to Modify:**
- `package.json` - Add build scripts

**Implementation Plan:**
- Build Windows: NSIS installer + portable .exe
- Build macOS: .dmg + .zip
- Add scripts: `build-win`, `build-mac`, `dist`
- Test: `npm run build-win` (Windows) or `npm run build-mac` (macOS)
- Verify dist/ folder contains build artifacts

---

## Current State

**Working Directory:** C:\Users\aj\Documents\dev\claude-anchors\.claude\worktrees\system-tray-app  
**Branch:** worktree-system-tray-app  
**Latest Commits:**
1. `1e3fbae` - "feat: add status dashboard with countdown timer" (Task 4)
2. `38fec28` - "feat: add per-day schedule and custom prompt configuration UI" (Task 3)
3. `4b4bb51` - "feat: add ConfigManager service for config persistence" (Task 2)
4. `790bf46` - "fix: add icon fallback, disable DevTools in production, add window null checks"
5. `ffe4be1` - "feat: initialize Electron project structure" (Task 1)

**Project Structure:**
```
.
├── package.json
├── electron/
│   ├── main.js (with ConfigManager init + IPC handlers)
│   ├── preload.js
│   └── app.css
├── src/
│   ├── App.js (3 views: Status, Settings, Logs)
│   ├── index.html
│   └── services/
│       ├── ConfigManager.js
│       └── StatusService.js
├── scripts/
│   └── (anchor-runner.ps1 and anchor-runner.sh to be created)
├── tests/
│   └── (ConfigManager.test.js to be created)
└── .gitignore
```

---

## To Continue Implementation

**Next Steps (for next session/model):**

1. **Verify working directory:** Still in `.claude/worktrees/system-tray-app`
2. **Start with Task 5:** Create TaskManager service and runner scripts
3. **Follow task order:** Tasks 5-12 have interdependencies but can be executed sequentially
4. **Use subagent-driven-development:** One fresh subagent per task, spec compliance review, code quality review
5. **Commit frequently:** Each task should end with a clean git commit

**Key Dependencies:**
- Task 5 (TaskManager) must complete before Tasks 8-9
- Task 8-9 (scheduling) depend on Task 5 (fireAnchor method)
- Task 11 (startup) depends on Tasks 8-9 (task registration)
- Task 7 (smart adjustment) has foundation but full logic can wait until later

**Context Needed for Next Session:**
- Working in worktree at: `.claude/worktrees/system-tray-app`
- Branch: `worktree-system-tray-app`
- All 4 tasks committed to git history
- All dependencies between tasks documented above
- Each task includes complete code in the main implementation plan: `docs/superpowers/plans/2026-05-21-system-tray-app.md`
