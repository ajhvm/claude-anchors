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
        const cmd = `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" -anchor "${anchor}" -scheduledTime "${scheduledTime}"`;
        const child = spawn('cmd.exe', ['/c', cmd], { shell: true, windowsHide: true });
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
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${escapedPath}\\" -anchor ${anchor} -scheduledTime ${timeStr}'`,
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
