class StatusService {
  static getWindowTimes(config) {
    const [startH, startM] = config.startTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const durationMinutes = config.windowDuration * 60;
    const windows = [];

    for (let i = 0; i < config.windowCount; i++) {
      const winStart = startMinutes + i * durationMinutes;
      const winEnd = winStart + durationMinutes;
      const sh = Math.floor(winStart / 60) % 24;
      const sm = winStart % 60;
      const eh = Math.floor(winEnd / 60) % 24;
      const em = winEnd % 60;

      const fmt12 = (h, m) => {
        const period = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')}${period}`;
      };

      windows.push({
        anchor: `w${i + 1}`,
        label: `Window ${i + 1}`,
        startMinutes: winStart,
        endMinutes: winEnd,
        startHHMM: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
        startStr: fmt12(sh, sm),
        endStr: fmt12(eh, em)
      });
    }

    return windows;
  }

  static getWindowStates(config, logs) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    return windows.map(win => {
      const windowLogs = (logs || []).filter(log => {
        if (log.anchor !== win.anchor) return false;
        if (!log.timestamp.startsWith(todayStr)) return false;
        const timePart = log.timestamp.split(' ')[1];
        if (!timePart) return false;
        const [lh, lm] = timePart.split(':').map(Number);
        const logMinutes = lh * 60 + lm;
        return logMinutes >= win.startMinutes && logMinutes < win.endMinutes;
      });

      const startedLog = windowLogs.find(l => l.status === 'ok');
      const hasSkipped = windowLogs.some(l => l.status === 'skipped');

      let state, detail;

      if (startedLog) {
        const timePart = startedLog.timestamp.split(' ')[1].slice(0, 5);
        const [h, m] = timePart.split(':').map(Number);
        const period = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 || 12;
        state = 'started';
        detail = `Started ${h12}:${String(m).padStart(2, '0')}${period}`;
      } else if (hasSkipped) {
        state = 'skipped';
        detail = 'Skipped';
      } else if (nowMinutes >= win.startMinutes && nowMinutes < win.endMinutes) {
        const remaining = win.endMinutes - nowMinutes;
        const rh = Math.floor(remaining / 60);
        const rm = remaining % 60;
        state = 'active';
        detail = rh > 0 ? `Active — ${rh}h ${rm}m remaining` : `Active — ${rm}m remaining`;
      } else if (win.startMinutes > nowMinutes) {
        const minsUntil = win.startMinutes - nowMinutes;
        const uh = Math.floor(minsUntil / 60);
        const um = minsUntil % 60;
        state = 'pending';
        detail = uh > 0 ? `Pending — fires in ${uh}h ${um}m` : `Pending — fires in ${um}m`;
      } else {
        state = 'expired';
        detail = 'Expired';
      }

      return { ...win, state, detail };
    });
  }

  static getCountdown(config) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const next = windows.find(w => w.startMinutes > nowMinutes);
    if (!next) return 'Done for today';
    const diff = next.startMinutes - nowMinutes;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  static getActiveWindow(config) {
    const windows = StatusService.getWindowTimes(config);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return windows.find(w => nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes) || null;
  }
}

if (typeof module !== 'undefined') module.exports = StatusService;
