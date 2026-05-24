const StatusService = require('./StatusService');
const LogReader = require('./LogReader');

class Scheduler {
  constructor(configManager, anchorRunner, options = {}) {
    this.configManager = configManager;
    this.anchorRunner = anchorRunner;
    this.logReader = options.logReader || new LogReader();
    this.onUpdate = options.onUpdate || (() => {});
    this._now = options.now || (() => new Date());
    this.timer = null;
    this.lastResult = null;
    this.nextFireAt = null;
    this.nextAnchor = null;
  }

  // Pure: decide which anchors to fire now (catch-up) and when the next
  // timer should fire. Reuses StatusService.getWindowTimes for window math.
  static plan(config, logs, now) {
    const windows = StatusService.getWindowTimes(config);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    const isDone = (anchor, startMin, endMin) =>
      (logs || []).some((l) => {
        if (l.anchor !== anchor) return false;
        if (!String(l.timestamp).startsWith(todayStr)) return false;
        const tp = String(l.timestamp).split(' ')[1];
        if (!tp) return false;
        const [lh, lm] = tp.split(':').map(Number);
        const lmin = lh * 60 + lm;
        return lmin >= startMin && lmin < endMin && (l.status === 'ok' || l.status === 'skipped');
      });

    const toFire = [];
    let nextFireAt = null;
    let nextAnchor = null;

    for (const w of windows) {
      const done = isDone(w.anchor, w.startMinutes, w.endMinutes);
      const isActive = nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes;
      const isFuture = w.startMinutes > nowMinutes;
      if (isActive && !done) toFire.push(w.anchor);
      if (isFuture && nextFireAt === null) {
        nextFireAt = Scheduler._dateAtMinutes(now, w.startMinutes, 0);
        nextAnchor = w.anchor;
      }
    }

    if (nextFireAt === null && windows.length > 0) {
      nextFireAt = Scheduler._dateAtMinutes(now, windows[0].startMinutes, 1);
      nextAnchor = windows[0].anchor;
    }

    return { toFire, nextFireAt, nextAnchor };
  }

  // Build a Date at (midnight + minutes), addDays days from `now`.
  // setHours normalizes minute values > 59 (and > 1440) into later hours/days.
  static _dateAtMinutes(now, minutes, addDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + (addDays || 0));
    d.setHours(0, minutes, 0, 0);
    return d;
  }

  start() {
    return this.recompute();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Serialized: concurrent callers (startup + apply-config + resume) chain so
  // two recomputes never run at once, preventing a double catch-up fire before
  // the first fire's log is written.
  recompute() {
    this._chain = (this._chain || Promise.resolve())
      .then(() => this._doRecompute())
      .catch((err) => console.error('Scheduler recompute error:', err));
    return this._chain;
  }

  async _doRecompute() {
    this.stop();
    const config = this.configManager.load();
    if (config.isPaused) {
      this.nextFireAt = null;
      this.nextAnchor = null;
      this.onUpdate(this.status());
      return;
    }
    const logs = this.logReader.getAllLogs();
    const { toFire, nextFireAt, nextAnchor } = Scheduler.plan(config, logs, this._now());
    for (const anchor of toFire) {
      const res = await this.anchorRunner.fire(anchor);
      this.lastResult = { anchor, ok: res.ok, time: this._now() };
    }
    this._arm(nextFireAt, nextAnchor);
    this.onUpdate(this.status());
  }

  _arm(nextFireAt, nextAnchor) {
    this.stop();
    this.nextFireAt = nextFireAt;
    this.nextAnchor = nextAnchor;
    if (!nextFireAt) return;
    let delay = nextFireAt.getTime() - this._now().getTime();
    if (delay < 0) delay = 0;
    this.timer = setTimeout(() => this._onTimer(nextAnchor), delay);
  }

  async _onTimer(anchor) {
    const res = await this.anchorRunner.fire(anchor);
    this.lastResult = { anchor, ok: res.ok, time: this._now() };
    this.onUpdate(this.status());
    await this.recompute();
  }

  async fireNow(anchor) {
    const res = await this.anchorRunner.fire(anchor);
    this.lastResult = { anchor, ok: res.ok, time: this._now() };
    this.onUpdate(this.status());
    return res;
  }

  status() {
    return {
      nextFireAt: this.nextFireAt,
      nextAnchor: this.nextAnchor,
      lastResult: this.lastResult,
      paused: Boolean(this.configManager.load().isPaused)
    };
  }
}

module.exports = Scheduler;
