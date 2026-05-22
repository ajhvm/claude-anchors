const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.configDir = path.join(os.homedir(), '.claude-anchors');
    this.configFile = path.join(this.configDir, 'config.json');
    this.logsDir = path.join(this.configDir, 'logs');
    this.stateFile = path.join(this.configDir, 'state.json');

    this.ensureDirectories();
    this.defaultConfig = {
      version: 1,
      timezone: 'America/Los_Angeles',
      smartAdjustment: true,
      isPaused: false,
      schedule: {
        monday: {
          w1Primary: '04:55',
          w1Backup: '05:10',
          w2Primary: '10:02',
          w2Backup: '10:15',
          w3Primary: '15:05',
          w3Backup: '15:20',
          w4Primary: '20:10',
          w4Backup: '20:25'
        },
        tuesday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        },
        wednesday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        },
        thursday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        },
        friday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        },
        saturday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        },
        sunday: {
          w1Primary: '04:55', w1Backup: '05:10', w2Primary: '10:02', w2Backup: '10:15',
          w3Primary: '15:05', w3Backup: '15:20', w4Primary: '20:10', w4Backup: '20:25'
        }
      },
      prompts: {
        w1Primary: 'Window 1 open — 5am block. Reply OK only.',
        w1Backup: 'Window 1 backup — 5am block. Reply OK only.',
        w2Primary: 'Window 2 open — 10am block. Reply OK only.',
        w2Backup: 'Window 2 backup — 10am block. Reply OK only.',
        w3Primary: 'Window 3 open — 3pm block. Reply OK only.',
        w3Backup: 'Window 3 backup — 3pm block. Reply OK only.',
        w4Primary: 'Window 4 open — 8pm block. Reply OK only.',
        w4Backup: 'Window 4 backup — 8pm block. Reply OK only.'
      }
    };
  }

  ensureDirectories() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
    return this.defaultConfig;
  }

  save(config) {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving config:', err);
      return false;
    }
  }

  getLogsDir() {
    return this.logsDir;
  }

  getConfigDir() {
    return this.configDir;
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Error loading state:', err);
    }
    return { date: new Date().toISOString().split('T')[0], windowStartTime: null, shifted: false };
  }

  saveState(state) {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving state:', err);
      return false;
    }
  }
}

module.exports = ConfigManager;
