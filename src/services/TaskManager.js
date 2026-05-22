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
        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -anchor "${anchor}" -prompt "${prompt}"`;
        const child = spawn('cmd.exe', ['/c', cmd], { shell: true });
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
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File \\"${scriptPath.replace(/\\/g, '\\\\')}\\" -anchor ${anchor}'`,
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

  async registerTask(anchor, timeStr) {
    if (this.isWindows) {
      return this.registerTaskWindows(anchor, timeStr);
    }
    // macOS implemented in Task 9
  }

  async updateTasks(config) {
    if (this.isWindows) {
      return this.updateTasksWindows(config);
    }
    // macOS implemented in Task 9
  }

  async pauseAll() {
    if (this.isWindows) {
      return this.pauseAllWindows();
    }
    // macOS implemented in Task 9
  }

  async resumeAll() {
    if (this.isWindows) {
      return this.resumeAllWindows();
    }
    // macOS implemented in Task 9
  }
}

module.exports = TaskManager;
