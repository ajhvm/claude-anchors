const fs = require('fs');
const path = require('path');
const os = require('os');

class LogReader {
  constructor() {
    this.logsDir = path.join(os.homedir(), '.claude-anchors', 'logs');
  }

  getAllLogs() {
    try {
      if (!fs.existsSync(this.logsDir)) return [];

      const files = fs.readdirSync(this.logsDir);
      const logs = [];

      files.forEach(file => {
        if (file.endsWith('.log')) {
          const filePath = path.join(this.logsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const entries = this.parseLogFile(content, file);
          logs.push(...entries);
        }
      });

      return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (err) {
      console.error('Error reading logs:', err);
      return [];
    }
  }

  parseLogFile(content, filename) {
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;

    for (let line of lines) {
      if (line.startsWith('===')) {
        if (currentEntry) entries.push(currentEntry);
        const match = line.match(/=== ([\d\-\s:]+) ===/);
        currentEntry = {
          anchor: filename.replace('.log', ''),
          timestamp: match ? match[1].trim() : new Date().toISOString(),
          status: 'pending',
          output: ''
        };
      } else if (line.trim() === 'OK') {
        if (currentEntry) currentEntry.status = 'ok';
      } else if (line.trim().startsWith('SKIPPED')) {
        if (currentEntry) currentEntry.status = 'skipped';
      } else if (line.trim().startsWith('ERROR')) {
        if (currentEntry) currentEntry.status = 'error';
      } else if (currentEntry && line.trim()) {
        currentEntry.output += line + '\n';
      }
    }

    if (currentEntry) entries.push(currentEntry);
    return entries;
  }
}

module.exports = LogReader;
