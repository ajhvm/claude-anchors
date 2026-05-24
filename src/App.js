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

    try {
      await window.api.invoke('apply-config', this.config);
    } catch (err) {
      console.error('Error applying config on init:', err);
    }

    setInterval(() => {
      if (this.currentView === 'status') this.loadStatusData();
    }, 60000);
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
    if (!this.config || !this.config.startTime) {
      return `<h2>Status</h2><p style="color:#999;">Loading...</p>`;
    }
    setTimeout(() => this.loadStatusData(), 0);
    return `
      <h2>Status</h2>
      <div class="subtitle">Today's windows</div>
      <div id="window-states" style="margin:16px 0;">Loading...</div>
      <div style="margin-top:16px;">
        <button id="fire-now-btn" onclick="app.fireNow()">Fire Now</button>
        <button onclick="app.togglePause()" style="margin-left:8px;">
          ${this.config.isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>
    `;
  }

  async loadStatusData() {
    const el = document.getElementById('window-states');
    if (!el) return;
    try {
      const logs = await window.api.invoke('get-logs');
      const states = StatusService.getWindowStates(this.config, logs);
      el.innerHTML = this.renderWindowStates(states);
    } catch (err) {
      el.innerHTML = `<p style="color:#dc2626;">Error loading status: ${err.message}</p>`;
    }
  }

  renderWindowStates(states) {
    const icons = { started: '✓', active: '●', skipped: '⊘', pending: '○', expired: '—' };
    const colors = { started: '#16a34a', active: '#2563eb', skipped: '#9ca3af', pending: '#9ca3af', expired: '#d1d5db' };
    let html = '<table style="width:100%;border-collapse:collapse;">';
    states.forEach(win => {
      const icon = icons[win.state] || '?';
      const color = colors[win.state] || '#000';
      html += `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 8px;color:#6b7280;font-size:13px;">${win.label}</td>
        <td style="padding:10px 8px;font-size:12px;color:#9ca3af;">${win.startStr} – ${win.endStr}</td>
        <td style="padding:10px 8px;font-weight:bold;color:${color};">${icon} ${win.detail}</td>
      </tr>`;
    });
    html += '</table>';
    return html;
  }

  renderSettingsView() {
    const cfg = this.config;
    const startTime = cfg.startTime || '05:00';
    const windowCount = cfg.windowCount || 4;
    const windowDuration = cfg.windowDuration || 5;
    const windowDurationSource = cfg.windowDurationSource || 'auto';
    const prompt = cfg.prompt || 'New context window open. Reply OK only.';
    const timezone = cfg.timezone || 'America/Los_Angeles';

    const radio = (val) => `
      <label style="margin-right:16px;">
        <input type="radio" name="window-count" value="${val}"
               ${windowCount === val ? 'checked' : ''}
               onchange="app.updateWindowTimesPreview()"> ${val}
      </label>`;

    const timezones = [
      'America/Los_Angeles', 'America/Denver', 'America/Chicago',
      'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'
    ];

    const previewText = this.getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration);

    return `
      <h2>Settings</h2>
      <div class="subtitle">Configure your schedule</div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Start Time</label>
        <input type="time" id="start-time" value="${startTime}"
               oninput="app.updateWindowTimesPreview()"
               style="padding:8px;font-size:14px;">
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Windows per day</label>
        ${radio(2)}${radio(3)}${radio(4)}
      </div>

      <div id="window-times-preview"
           style="margin:-12px 0 20px;color:#6b7280;font-size:13px;">${previewText}</div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Window Duration</label>
        <div style="color:#6b7280;font-size:13px;margin-bottom:8px;">
          ${windowDurationSource === 'auto' ? `Auto-detected: ${windowDuration}h` : `Manual: ${windowDuration}h`}
          <button onclick="app.redetectDuration()" style="margin-left:8px;font-size:12px;">Re-detect</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:13px;">Override:</span>
          <input type="number" id="duration-override" min="1" max="24"
                 value="${windowDurationSource === 'manual' ? windowDuration : ''}"
                 placeholder="hours" style="width:80px;padding:6px;">
          <button onclick="app.resetDurationToAuto()" style="font-size:12px;">Reset to auto</button>
        </div>
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Prompt</label>
        <textarea id="prompt" rows="3"
                  style="width:100%;padding:8px;font-family:monospace;font-size:12px;box-sizing:border-box;">${prompt}</textarea>
      </div>

      <div style="margin:20px 0;">
        <label style="display:block;font-weight:bold;margin-bottom:6px;">Timezone</label>
        <select id="timezone" style="width:100%;padding:8px;">
          ${timezones.map(tz => `<option value="${tz}" ${tz === timezone ? 'selected' : ''}>${tz}</option>`).join('')}
        </select>
      </div>

      <button onclick="app.saveSettings()" style="margin-top:8px;">Save Settings</button>
    `;
  }

  getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration) {
    const previewConfig = { startTime, windowCount, windowDuration };
    const windows = StatusService.getWindowTimes(previewConfig);
    return '→ ' + windows.map(w => w.startStr).join(' · ');
  }

  updateWindowTimesPreview() {
    const startTimeEl = document.getElementById('start-time');
    const windowCountEl = document.querySelector('input[name="window-count"]:checked');
    const startTime = startTimeEl ? startTimeEl.value : (this.config.startTime || '05:00');
    const windowCount = windowCountEl ? parseInt(windowCountEl.value) : (this.config.windowCount || 4);
    const windowDuration = this.config.windowDuration || 5;
    const previewEl = document.getElementById('window-times-preview');
    if (previewEl) previewEl.textContent = this.getWindowTimesPreviewFromConfig(startTime, windowCount, windowDuration);
  }

  async redetectDuration() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Detecting...';
    try {
      const updated = await window.api.invoke('detect-window-duration');
      if (updated) {
        this.config = await window.api.invoke('load-config');
        this.renderContent();
      } else {
        alert('Could not detect window duration. Check that claude is installed and authenticated.');
        btn.disabled = false;
        btn.textContent = 'Re-detect';
      }
    } catch (err) {
      alert('Detection failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Re-detect';
    }
  }

  async resetDurationToAuto() {
    this.config.windowDurationSource = 'auto';
    await window.api.invoke('save-config', this.config);
    this.renderContent();
  }

  renderLogsView() {
    // Fetch logs asynchronously after render
    setTimeout(() => this.loadLogs(), 0);
    return `
      <h2>Logs</h2>
      <div class="subtitle">Recent anchor executions</div>
      <div id="logs-container">Loading...</div>
    `;
  }

  async loadLogs() {
    const container = document.getElementById('logs-container');
    if (!container) return;

    try {
      const logs = await window.api.invoke('get-logs');

      if (!logs || logs.length === 0) {
        container.innerHTML = '<p style="color:#999;margin-top:16px;">No logs yet. Anchors will log here when they run.</p>';
        return;
      }

      let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:monospace;">';
      html += '<thead><tr style="border-bottom:2px solid #eee;text-align:left;">';
      html += '<th style="padding:8px;">Timestamp</th><th style="padding:8px;">Anchor</th><th style="padding:8px;">Status</th>';
      html += '</tr></thead><tbody>';

      logs.slice(0, 50).forEach(log => {
        const statusColor = log.status === 'ok' ? '#16a34a' : log.status === 'error' ? '#dc2626' : '#999';
        html += `<tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:8px;">${log.timestamp}</td>
          <td style="padding:8px;">${log.anchor}</td>
          <td style="padding:8px;color:${statusColor};font-weight:bold;">${log.status.toUpperCase()}</td>
        </tr>`;
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<p style="color:#dc2626;">Error loading logs: ${err.message}</p>`;
    }
  }

  switchView(view) {
    this.currentView = view;
    this.renderSidebar();
    this.renderContent();
  }

  async loadConfig() {
    try {
      this.config = await window.api.invoke('load-config');
      if (!this.config) throw new Error('No config returned');
    } catch (err) {
      console.error('Failed to load config:', err);
      alert('Error loading settings. Using defaults.');
      this.config = {
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
  }

  async saveSettings() {
    const startTime = document.getElementById('start-time').value;
    const windowCountEl = document.querySelector('input[name="window-count"]:checked');
    const windowCount = windowCountEl ? parseInt(windowCountEl.value) : this.config.windowCount;
    const durationOverride = document.getElementById('duration-override').value.trim();
    const timezone = document.getElementById('timezone').value;
    const prompt = document.getElementById('prompt').value;

    if (durationOverride) {
      const hours = parseInt(durationOverride, 10);
      if (isNaN(hours) || hours < 1 || hours > 24) {
        alert('Duration override must be a number between 1 and 24');
        return;
      }
      this.config.windowDuration = hours;
      this.config.windowDurationSource = 'manual';
    }

    this.config.startTime = startTime;
    this.config.windowCount = windowCount;
    this.config.timezone = timezone;
    this.config.prompt = prompt;

    const success = await window.api.invoke('save-config', this.config);
    if (success) {
      alert('Settings saved!');
      await window.api.invoke('apply-config', this.config);
    } else {
      alert('Error saving settings');
    }
  }

  async fireNow() {
    const active = StatusService.getActiveWindow(this.config);
    if (!active) {
      alert('No active window right now');
      return;
    }
    alert(`Firing ${active.label}...`);
    await window.api.invoke('fire-anchor', active.anchor, active.startHHMM);
    alert('Anchor fired!');
    await this.loadStatusData();
  }

  async togglePause() {
    this.config.isPaused = !this.config.isPaused;
    await window.api.invoke('save-config', this.config);

    if (this.config.isPaused) {
      window.api.send('pause-all');
    } else {
      window.api.send('resume-all');
    }

    this.renderContent();
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
