class StatusService {
  constructor(config) {
    this.config = config;
    this.updateInterval = null;
  }

  getCurrentWindow() {
    const now = new Date();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    const todaySchedule = this.config.schedule[dayName];

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;

    // Parse schedule times and find current window
    const times = [];
    Object.entries(todaySchedule).forEach(([anchor, timeStr]) => {
      const [h, m] = timeStr.split(':').map(Number);
      times.push({ anchor, timeStr, minutes: h * 60 + m });
    });
    times.sort((a, b) => a.minutes - b.minutes);

    for (let i = 0; i < times.length; i++) {
      if (currentTime < times[i].minutes) {
        return { window: this.getWindowName(times[i].anchor), time: times[i].timeStr };
      }
    }

    return { window: times[times.length - 1].anchor, time: times[times.length - 1].timeStr };
  }

  getWindowName(anchor) {
    const map = {
      w1Primary: 'Window 1: 5am – 10am',
      w1Backup: 'Window 1: 5am – 10am',
      w2Primary: 'Window 2: 10am – 3pm',
      w2Backup: 'Window 2: 10am – 3pm',
      w3Primary: 'Window 3: 3pm – 8pm',
      w3Backup: 'Window 3: 3pm – 8pm',
      w4Primary: 'Window 4: 8pm – 1am',
      w4Backup: 'Window 4: 8pm – 1am'
    };
    return map[anchor] || anchor;
  }

  getNextAnchor() {
    const now = new Date();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    const todaySchedule = this.config.schedule[dayName];

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const times = [];

    Object.entries(todaySchedule).forEach(([anchor, timeStr]) => {
      const [h, m] = timeStr.split(':').map(Number);
      times.push({ anchor, timeStr, minutes: h * 60 + m });
    });
    times.sort((a, b) => a.minutes - b.minutes);

    for (let t of times) {
      if (t.minutes > currentMinutes) {
        return { anchor: t.anchor, time: t.timeStr, minutes: t.minutes };
      }
    }

    return null; // No more anchors today
  }

  getCountdown() {
    const next = this.getNextAnchor();
    if (!next) return 'Done for today';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const diff = next.minutes - currentMinutes;

    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  }

  startCountdownUpdates(callback) {
    callback();
    this.updateInterval = setInterval(() => {
      callback();
    }, 60000); // Update every minute
  }

  stopCountdownUpdates() {
    if (this.updateInterval) clearInterval(this.updateInterval);
  }
}
