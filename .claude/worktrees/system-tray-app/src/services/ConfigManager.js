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
      version: 2,
      timezone: 'America/Los_Angeles',
      startTime: '05:00',
      windowCount: 4,
      windowDuration: 5,
      windowDurationSource: 'auto',
      isPaused: false,
      prompt: 'New context window open. Reply OK only.'
    };
  }

  ensureDirectories() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true });
  }

  migrateV1toV2(v1Config) {
    const startTime =
      (v1Config.schedule && v1Config.schedule.monday && v1Config.schedule.monday.w1Primary) ||
      '05:00';
    const prompt =
      (v1Config.prompts && v1Config.prompts.w1Primary) ||
      'New context window open. Reply OK only.';
    return {
      version: 2,
      timezone: v1Config.timezone || 'America/Los_Angeles',
      startTime,
      windowCount: 4,
      windowDuration: 5,
      windowDurationSource: 'auto',
      isPaused: Boolean(v1Config.isPaused),
      prompt
    };
  }

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const config = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        if (!config.version || config.version < 2) {
          const migrated = this.migrateV1toV2(config);
          this.save(migrated);
          return migrated;
        }
        return config;
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
    return { ...this.defaultConfig };
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

  getLogsDir() { return this.logsDir; }
  getConfigDir() { return this.configDir; }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile))
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
    } catch (err) {
      console.error('Error loading state:', err);
    }
    return { date: new Date().toISOString().split('T')[0], windowStartTime: null };
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
