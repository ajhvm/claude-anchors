class App {
  constructor() {
    this.currentView = 'status';
    this.config = {};
    this.init();
  }

  async init() {
    this.render();
    this.setupEventListeners();
    await this.loadConfig();
  }

  render() {
    document.body.innerHTML = `
      <div class="app-container">
        <div class="sidebar" id="sidebar"></div>
        <div class="content" id="content"></div>
      </div>
    `;
    this.renderSidebar();
    this.renderContent();
  }

  renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    const items = ['Status', 'Settings', 'Logs'];
    sidebar.innerHTML = items.map(item => `
      <div class="sidebar-item ${item.toLowerCase() === this.currentView ? 'active' : ''}"
           onclick="app.switchView('${item.toLowerCase()}')">
        ${item}
      </div>
    `).join('');
  }

  renderContent() {
    const content = document.getElementById('content');
    switch (this.currentView) {
      case 'status':
        content.innerHTML = this.renderStatusView();
        break;
      case 'settings':
        content.innerHTML = this.renderSettingsView();
        break;
      case 'logs':
        content.innerHTML = this.renderLogsView();
        break;
    }
  }

  renderStatusView() {
    return `
      <h2>Claude Anchors</h2>
      <div class="subtitle">Current window and next anchor</div>
      <div class="status-box">
        <div class="status-label">CURRENT WINDOW</div>
        <div class="status-value" id="current-window">—</div>
      </div>
      <div class="status-box">
        <div class="status-label">Next anchor fires in</div>
        <div class="status-value" id="countdown">—</div>
      </div>
      <button onclick="app.fireNow()">Fire Now</button>
      <button onclick="app.togglePause()" style="margin-left: 8px;">Pause</button>
    `;
  }

  renderSettingsView() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const anchorLabels = {
      w1Primary: 'W1 Primary',
      w1Backup: 'W1 Backup',
      w2Primary: 'W2 Primary',
      w2Backup: 'W2 Backup',
      w3Primary: 'W3 Primary',
      w3Backup: 'W3 Backup',
      w4Primary: 'W4 Primary',
      w4Backup: 'W4 Backup'
    };

    let scheduleGrid = '<div style="overflow-x: auto; margin: 16px 0;"><table style="width: 100%; border-collapse: collapse;">';
    scheduleGrid += '<tr><th>Day</th>' + anchors.map(a => `<th>${anchorLabels[a]}</th>`).join('') + '</tr>';

    days.forEach((day, idx) => {
      scheduleGrid += `<tr><td><strong>${dayLabels[idx]}</strong></td>`;
      anchors.forEach(anchor => {
        const value = this.config.schedule[day][anchor];
        scheduleGrid += `<td><input type="time" id="time-${day}-${anchor}" value="${value}" style="width: 100%; padding: 4px;"></td>`;
      });
      scheduleGrid += '</tr>';
    });
    scheduleGrid += '</table></div>';

    let promptsHtml = '<div style="margin-top: 16px;"><h3>Custom Prompts</h3>';
    anchors.forEach(anchor => {
      const prompt = this.config.prompts[anchor] || '';
      promptsHtml += `
        <div style="margin: 8px 0;">
          <label>${anchorLabels[anchor]}</label><br>
          <textarea id="prompt-${anchor}" style="width: 100%; height: 60px; padding: 8px; margin-top: 4px; font-family: monospace; font-size: 12px;">${prompt}</textarea>
        </div>
      `;
    });
    promptsHtml += '</div>';

    return `
      <h2>Settings</h2>
      <div class="subtitle">Configure your schedule and preferences</div>
      <div style="margin: 16px 0;">
        <label>Timezone</label><br>
        <select id="timezone" style="width: 100%; padding: 8px; margin-top: 4px;">
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="America/Denver">America/Denver</option>
          <option value="America/Chicago">America/Chicago</option>
          <option value="America/New_York">America/New_York</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Paris">Europe/Paris</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="Australia/Sydney">Australia/Sydney</option>
        </select>
      </div>
      <div style="margin: 16px 0;">
        <label><input type="checkbox" id="smart-adjustment"> Smart Adjustment</label>
        <div class="subtitle">Auto-adjust remaining windows if an anchor runs late</div>
      </div>
      <h3>Daily Schedule</h3>
      ${scheduleGrid}
      <h3>Custom Prompts</h3>
      ${promptsHtml}
      <button onclick="app.saveSettings()" style="margin-top: 16px;">Save Settings</button>
    `;
  }

  renderLogsView() {
    return `
      <h2>Logs</h2>
      <div class="subtitle">Recent anchor executions</div>
      <div id="logs-list" style="font-family: monospace; font-size: 12px;"></div>
    `;
  }

  switchView(view) {
    this.currentView = view;
    this.renderSidebar();
    this.renderContent();
  }

  async loadConfig() {
    this.config = await window.api.invoke('load-config');
    document.getElementById('timezone').value = this.config.timezone || 'America/Los_Angeles';
    document.getElementById('smart-adjustment').checked = this.config.smartAdjustment !== false;
  }

  async saveSettings() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const anchors = ['w1Primary', 'w1Backup', 'w2Primary', 'w2Backup', 'w3Primary', 'w3Backup', 'w4Primary', 'w4Backup'];

    this.config.timezone = document.getElementById('timezone').value;
    this.config.smartAdjustment = document.getElementById('smart-adjustment').checked;

    // Collect schedule times
    days.forEach(day => {
      this.config.schedule[day] = {};
      anchors.forEach(anchor => {
        const input = document.getElementById(`time-${day}-${anchor}`);
        this.config.schedule[day][anchor] = input.value;
      });
    });

    // Collect custom prompts
    anchors.forEach(anchor => {
      const textarea = document.getElementById(`prompt-${anchor}`);
      this.config.prompts[anchor] = textarea.value;
    });

    const success = await window.api.invoke('save-config', this.config);
    if (success) {
      alert('Settings saved!');
      await window.api.invoke('apply-config', this.config);
    } else {
      alert('Error saving settings');
    }
  }

  fireNow() {
    window.api.send('fire-now');
  }

  togglePause() {
    window.api.send('toggle-pause');
  }

  updateTimezone() {
    // Will be handled by save
  }

  setupEventListeners() {
    window.api.on('pause', () => alert('Paused'));
    window.api.on('resume', () => alert('Resumed'));
  }
}

const app = new App();
