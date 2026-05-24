const Scheduler = require('../src/services/Scheduler');

const STD = { startTime: '05:00', windowCount: 4, windowDuration: 5 }; // 5,10,15,20h

function testNextIsW1WhenBeforeStart() {
  const now = new Date(2026, 5, 15, 2, 0, 0); // 02:00, before 05:00
  const { toFire, nextAnchor } = Scheduler.plan(STD, [], now);
  console.assert(toFire.length === 0, `no catch-up, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w1', `next w1, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan before-start passed');
}

function testCatchUpActiveWindow() {
  const now = new Date(2026, 5, 15, 11, 0, 0); // 11:00 → inside w2 (10:00-15:00)
  const { toFire, nextAnchor } = Scheduler.plan(STD, [], now);
  console.assert(toFire.length === 1 && toFire[0] === 'w2', `catch-up w2, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w3', `next w3, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan catch-up active passed');
}

function testNoCatchUpWhenAlreadyFired() {
  const now = new Date(2026, 5, 15, 11, 0, 0);
  const logs = [{ anchor: 'w2', timestamp: '2026-06-15 10:01:00', status: 'ok' }];
  const { toFire, nextAnchor } = Scheduler.plan(STD, logs, now);
  console.assert(toFire.length === 0, `already fired, no catch-up, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w3', `next w3, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan skip-already-fired passed');
}

function testSkippedLogCountsAsDone() {
  const now = new Date(2026, 5, 15, 11, 0, 0);
  const logs = [{ anchor: 'w2', timestamp: '2026-06-15 10:30:00', status: 'skipped' }];
  const { toFire } = Scheduler.plan(STD, logs, now);
  console.assert(toFire.length === 0, `skipped counts as done, got ${JSON.stringify(toFire)}`);
  console.log('✓ Scheduler.plan skipped-counts-as-done passed');
}

function testRollsToTomorrowWhenDone() {
  const cfg = { startTime: '05:00', windowCount: 2, windowDuration: 1 }; // 5-6, 6-7
  const now = new Date(2026, 5, 15, 8, 0, 0); // 08:00 → both expired, none active/future
  const { toFire, nextAnchor, nextFireAt } = Scheduler.plan(cfg, [], now);
  console.assert(toFire.length === 0, `nothing to fire, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w1', `next w1, got ${nextAnchor}`);
  console.assert(nextFireAt.getDate() === 16, `fires tomorrow (16th), got ${nextFireAt.getDate()}`);
  console.assert(nextFireAt.getMonth() === 5, `fires in June (month 5), got ${nextFireAt.getMonth()}`);
  console.assert(nextFireAt.getHours() === 5, `fires at 05:00, got ${nextFireAt.getHours()}`);
  console.log('✓ Scheduler.plan rolls-to-tomorrow passed');
}

// Regression for the local-date fix: a log written earlier the SAME LOCAL day
// must count as done. The log date is derived from now's local components so
// the test never false-fails; on UTC-negative machines in the evening it would
// fail if plan() reverted to the UTC date (toISOString).
function testUsesLocalDateNotUTC() {
  const now = new Date(2026, 5, 15, 18, 0, 0); // 18:00 local → inside w3 (15:00-20:00)
  const p = (n) => String(n).padStart(2, '0');
  const localDate = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const logs = [{ anchor: 'w3', timestamp: `${localDate} 15:30:00`, status: 'ok' }];
  const { toFire, nextAnchor } = Scheduler.plan(STD, logs, now);
  console.assert(toFire.length === 0, `same-local-day log → done, got ${JSON.stringify(toFire)}`);
  console.assert(nextAnchor === 'w4', `next w4, got ${nextAnchor}`);
  console.log('✓ Scheduler.plan uses-local-date passed');
}

async function testRecomputeFiresCatchUpAndArms() {
  const fired = [];
  const fakeRunner = { fire: (a) => { fired.push(a); return Promise.resolve({ ok: true, reply: 'OK' }); } };
  const fakeConfig = { load: () => ({ startTime: '05:00', windowCount: 4, windowDuration: 5, isPaused: false }) };
  const fakeLogs = { getAllLogs: () => [] };
  const fixedNow = () => new Date(2026, 5, 15, 11, 0, 0); // inside w2
  const s = new Scheduler(fakeConfig, fakeRunner, { logReader: fakeLogs, now: fixedNow });
  await s.recompute();
  console.assert(fired.length === 1 && fired[0] === 'w2', `recompute fires w2, got ${JSON.stringify(fired)}`);
  console.assert(s.timer !== null, 'recompute arms a timer');
  console.assert(s.nextAnchor === 'w3', `armed for w3, got ${s.nextAnchor}`);
  s.stop();
  console.log('✓ Scheduler.recompute catch-up + arm passed');
}

async function testRecomputePausedDoesNothing() {
  const fired = [];
  const fakeRunner = { fire: (a) => { fired.push(a); return Promise.resolve({ ok: true }); } };
  const fakeConfig = { load: () => ({ startTime: '05:00', windowCount: 4, windowDuration: 5, isPaused: true }) };
  const fakeLogs = { getAllLogs: () => [] };
  const s = new Scheduler(fakeConfig, fakeRunner, { logReader: fakeLogs, now: () => new Date(2026, 5, 15, 11, 0, 0) });
  await s.recompute();
  console.assert(fired.length === 0, `paused fires nothing, got ${JSON.stringify(fired)}`);
  console.assert(s.timer === null, 'paused arms no timer');
  console.log('✓ Scheduler.recompute paused passed');
}

async function testSetPausedPersistsAndToggles() {
  const cfg = { startTime: '05:00', windowCount: 4, windowDuration: 5, isPaused: false };
  let saved = null;
  const fakeConfig = {
    load: () => ({ ...cfg }),
    save: (c) => { saved = c; cfg.isPaused = c.isPaused; return true; }
  };
  const fakeRunner = { fire: () => Promise.resolve({ ok: true }) };
  const fakeLogs = { getAllLogs: () => [] };
  const s = new Scheduler(fakeConfig, fakeRunner, { logReader: fakeLogs, now: () => new Date(2026, 5, 15, 11, 0, 0) });

  await s.setPaused(true);
  console.assert(saved && saved.isPaused === true, 'setPaused(true) persists isPaused=true');
  console.assert(s.timer === null, 'setPaused(true) clears the timer');

  await s.setPaused(false);
  console.assert(cfg.isPaused === false, 'setPaused(false) persists isPaused=false');
  console.assert(s.timer !== null, 'setPaused(false) re-arms a timer');
  s.stop();
  console.log('✓ Scheduler.setPaused persists + toggles passed');
}

(async () => {
  testNextIsW1WhenBeforeStart();
  testCatchUpActiveWindow();
  testNoCatchUpWhenAlreadyFired();
  testSkippedLogCountsAsDone();
  testRollsToTomorrowWhenDone();
  testUsesLocalDateNotUTC();
  await testRecomputeFiresCatchUpAndArms();
  await testRecomputePausedDoesNothing();
  await testSetPausedPersistsAndToggles();
})();
