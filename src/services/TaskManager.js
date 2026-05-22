const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
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

  async registerTask(day, anchor, timeStr) {
    // TODO: Windows Task Scheduler or macOS launchd registration
    // For now, just log intent
    console.log(`Register: ${day} ${anchor} at ${timeStr}`);
  }

  async updateTasks(config) {
    // TODO: Update all Task Scheduler/launchd tasks based on config
    console.log('Updating tasks with new config');
  }

  async pauseAll() {
    // TODO: Disable all Task Scheduler/launchd tasks
    console.log('Pausing all anchors');
  }

  async resumeAll() {
    // TODO: Enable all Task Scheduler/launchd tasks
    console.log('Resuming all anchors');
  }
}

module.exports = TaskManager;
