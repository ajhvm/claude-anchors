const fs = require('fs');
const os = require('os');
const path = require('path');

class AnchorRunner {
  // execFileFn is injectable for testing; defaults to child_process.execFile.
  constructor(configManager, execFileFn) {
    this.configManager = configManager;
    this._execFile = execFileFn || require('child_process').execFile;
  }

  _claudePath() {
    return os.platform() === 'win32'
      ? path.join(process.env.APPDATA, 'npm', 'claude.cmd')
      : 'claude';
  }

  _timestamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  _appendLog(anchor, body) {
    const logFile = path.join(this.configManager.getLogsDir(), `${anchor}.log`);
    fs.appendFileSync(logFile, `=== ${this._timestamp()} ===\n${body}\n\n`, 'utf-8');
  }

  logSkipped(anchor) {
    this._appendLog(anchor, 'SKIPPED: Window expired');
  }

  // Fires the anchor and records the result. Resolves { ok, reply }.
  fire(anchor) {
    return new Promise((resolve) => {
      const config = this.configManager.load();
      const claude = this._claudePath();
      this._execFile(
        claude,
        ['-p', config.prompt],
        { timeout: 60000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            this._appendLog(anchor, `ERROR: ${err.message}`);
            resolve({ ok: false, reply: '' });
            return;
          }
          const reply = (stdout || '').trim();
          this._appendLog(anchor, reply || 'ERROR: empty response');
          resolve({ ok: reply.length > 0, reply });
        }
      );
    });
  }
}

module.exports = AnchorRunner;
