const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const ConfigManager = require('./ConfigManager');

class TaskManager {
  constructor() {
    this.platform = os.platform(); // 'win32', 'darwin', 'linux'
    this.isWindows = this.platform === 'win32';
    this.configManager = new ConfigManager();
  }

  async fireAnchor(anchor, prompt) {
    return new Promise((resolve) => {
      const scriptDir = path.join(__dirname, '../../scripts');
      const scriptName = this.isWindows ? 'anchor-runner.ps1' : 'anchor-runner.sh';
      const scriptPath = path.join(scriptDir, scriptName);

      if (this.isWindows) {
        const cmd = `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" -anchor "${anchor}" -prompt "${prompt}"`;
        const child = spawn('cmd.exe', ['/c', cmd], { shell: true, windowsHide: true });
        child.on('close', () => resolve(true));
      } else {
        const child = spawn('bash', [scriptPath, anchor, prompt]);
        child.on('close', () => resolve(true));
      }
    });
  }

  async registerTaskWindows(anchor, timeStr) {
    const scriptDir = path.join(__dirname, '../../scripts');
    const scriptPath = path.join(scriptDir, 'anchor-runner.ps1');
    const taskName = `ClaudeAnchor-${anchor}`;
    const [hour, minute] = timeStr.split(':').map(n => parseInt(n, 10));

    // Validate timeStr
    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.error(`Invalid timeStr for ${anchor}: ${timeStr}`);
      return false;
    }

    const psScript = [
      `$trigger = New-ScheduledTaskTrigger -Daily -At '${hour}:${minute < 10 ? '0' + minute : minute}'`,
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${scriptPath.replace(/\\/g, '\\\\')}\\" -anchor ${anchor}'`,
      `$settings = New-ScheduledTaskSettingsSet -WakeToRun -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)`,
      `Register-ScheduledTask -TaskName '${taskName}' -Trigger $trigger -Action $action -Settings $settings -Force`
    ].join('; ');

    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', psScript], (err) => {
        if (err) console.error(`Error registering ${taskName}:`, err.message);
        resolve(!err);
      });
    });
  }

  async updateTasksWindows(config) {
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];
    const days = Object.keys(config.schedule);

    // Use monday's schedule as the base (Task Scheduler creates daily tasks, not per-day-of-week)
    const baseDay = days[0];
    for (const anchor of anchors) {
      const timeStr = config.schedule[baseDay][anchor];
      await this.registerTaskWindows(anchor, timeStr);
    }
  }

  async pauseAllWindows() {
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];

    for (const anchor of anchors) {
      const taskName = `ClaudeAnchor-${anchor}`;
      execFile('powershell.exe', ['-NoProfile', '-Command', `Disable-ScheduledTask -TaskName '${taskName}'`], (err) => {
        if (err) console.error(`Error disabling ${taskName}:`, err.message);
      });
    }
  }

  async resumeAllWindows() {
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];

    for (const anchor of anchors) {
      const taskName = `ClaudeAnchor-${anchor}`;
      execFile('powershell.exe', ['-NoProfile', '-Command', `Enable-ScheduledTask -TaskName '${taskName}'`], (err) => {
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

    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const scriptDir = path.join(__dirname, '../../scripts');
    const scriptPath = path.join(scriptDir, 'anchor-runner.sh');
    const plistName = `com.claudeanchors.${anchor}.plist`;
    const plistPath = path.join(launchAgentsDir, plistName);

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
  <string>${path.join(os.homedir(), '.claude-anchors', 'logs', anchor + '.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), '.claude-anchors', 'logs', anchor + '.log')}</string>
</dict>
</plist>`;

    try {
      const fs = require('fs');
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }
      fs.writeFileSync(plistPath, plistContent, 'utf-8');
    } catch (err) {
      console.error(`Error writing plist for ${anchor}:`, err.message);
      return false;
    }

    return new Promise((resolve) => {
      // Unload first in case it's already loaded, then load the new one
      execFile('launchctl', ['unload', plistPath], () => {
        execFile('launchctl', ['load', plistPath], (err) => {
          if (err) console.error(`Error loading ${plistName}:`, err.message);
          resolve(!err);
        });
      });
    });
  }

  async updateTasksMacOS(config) {
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];
    const baseDay = 'monday';

    for (const anchor of anchors) {
      const timeStr = config.schedule[baseDay][anchor];
      await this.registerTaskMacOS(anchor, timeStr);
    }
  }

  async pauseAllMacOS() {
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];

    for (const anchor of anchors) {
      const plistPath = path.join(launchAgentsDir, `com.claudeanchors.${anchor}.plist`);
      execFile('launchctl', ['unload', plistPath], (err) => {
        if (err) console.error(`Error unloading ${anchor}:`, err.message);
      });
    }
  }

  async resumeAllMacOS() {
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];

    for (const anchor of anchors) {
      const plistPath = path.join(launchAgentsDir, `com.claudeanchors.${anchor}.plist`);
      execFile('launchctl', ['load', plistPath], (err) => {
        if (err) console.error(`Error loading ${anchor}:`, err.message);
      });
    }
  }

  async registerTask(anchor, timeStr) {
    if (this.isWindows) {
      return this.registerTaskWindows(anchor, timeStr);
    } else if (this.platform === 'darwin') {
      return this.registerTaskMacOS(anchor, timeStr);
    }
  }

  async updateTasks(config) {
    if (this.isWindows) {
      return this.updateTasksWindows(config);
    } else if (this.platform === 'darwin') {
      return this.updateTasksMacOS(config);
    }
  }

  async pauseAll() {
    if (this.isWindows) {
      return this.pauseAllWindows();
    } else if (this.platform === 'darwin') {
      return this.pauseAllMacOS();
    }
  }

  async resumeAll() {
    if (this.isWindows) {
      return this.resumeAllWindows();
    } else if (this.platform === 'darwin') {
      return this.resumeAllMacOS();
    }
  }
}

module.exports = TaskManager;
