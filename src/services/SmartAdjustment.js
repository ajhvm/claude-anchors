const fs = require('fs');
const path = require('path');
const os = require('os');

class SmartAdjustment {
  constructor(config) {
    this.config = config;
    this.stateFile = path.join(os.homedir(), '.claude-anchors', 'state.json');
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
    return this.getDefaultState();
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

  getDefaultState() {
    const today = new Date().toISOString().split('T')[0];
    return { date: today, windowStartTime: null, shifted: false };
  }

  resetStateIfNewDay() {
    const state = this.loadState();
    const today = new Date().toISOString().split('T')[0];
    if (state.date !== today) {
      const newState = this.getDefaultState();
      this.saveState(newState);
      return newState;
    }
    return state;
  }

  recordAnchorRun(timestamp) {
    if (!this.config.smartAdjustment) return;

    const state = this.resetStateIfNewDay();
    // Smart window shifting is tracked here — full logic deferred to future enhancement
    console.log(`Anchor run recorded at ${timestamp}, smart adjustment state:`, state);
  }
}

module.exports = SmartAdjustment;
