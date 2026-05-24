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

      execFile(claude, ['-p', prompt], { timeout: 30000, windowsHide: true }, (err, stdout) => {
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
