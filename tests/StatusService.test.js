const StatusService = require('../src/services/StatusService');

function testGetWindowTimes4() {
  const config = { startTime: '05:00', windowCount: 4, windowDuration: 5 };
  const windows = StatusService.getWindowTimes(config);
  console.assert(windows.length === 4, 'Returns 4 windows');
  console.assert(windows[0].anchor === 'w1', 'First anchor is w1');
  console.assert(windows[0].startHHMM === '05:00', `w1 starts at 05:00, got: ${windows[0].startHHMM}`);
  console.assert(windows[1].startHHMM === '10:00', `w2 starts at 10:00, got: ${windows[1].startHHMM}`);
  console.assert(windows[2].startHHMM === '15:00', `w3 starts at 15:00, got: ${windows[2].startHHMM}`);
  console.assert(windows[3].startHHMM === '20:00', `w4 starts at 20:00, got: ${windows[3].startHHMM}`);
  console.log('✓ getWindowTimes (4 windows) passed');
}

function testGetWindowTimes2() {
  const config = { startTime: '06:00', windowCount: 2, windowDuration: 6 };
  const windows = StatusService.getWindowTimes(config);
  console.assert(windows.length === 2, 'Returns 2 windows');
  console.assert(windows[0].startHHMM === '06:00', `w1=06:00, got: ${windows[0].startHHMM}`);
  console.assert(windows[1].startHHMM === '12:00', `w2=12:00, got: ${windows[1].startHHMM}`);
  console.log('✓ getWindowTimes (2 windows) passed');
}

function testGetWindowStatesNoLogs() {
  const config = { startTime: '01:00', windowCount: 2, windowDuration: 1 };
  const states = StatusService.getWindowStates(config, []);
  console.assert(states.length === 2, 'Returns 2 states');
  const valid = ['expired', 'active', 'pending', 'started', 'skipped'];
  states.forEach(s => console.assert(valid.includes(s.state), `Valid state: ${s.state}`));
  console.log('✓ getWindowStates (no logs) passed');
}

function testGetWindowStatesStarted() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const startH = String(Math.max(h - 1, 0)).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const startTime = `${startH}:${m}`;
  const config = { startTime, windowCount: 1, windowDuration: 2 };
  const fakeLog = {
    anchor: 'w1',
    timestamp: `${todayStr} ${startH}:${m}:00`,
    status: 'ok'
  };
  const states = StatusService.getWindowStates(config, [fakeLog]);
  console.assert(states[0].state === 'started', `Expected started, got: ${states[0].state}`);
  console.log('✓ getWindowStates (started) passed');
}

function testGetWindowStatesSkipped() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const startH = String(Math.max(h - 1, 0)).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const startTime = `${startH}:${m}`;
  const config = { startTime, windowCount: 1, windowDuration: 2 };
  const fakeLog = {
    anchor: 'w1',
    timestamp: `${todayStr} ${startH}:${m}:00`,
    status: 'skipped'
  };
  const states = StatusService.getWindowStates(config, [fakeLog]);
  console.assert(states[0].state === 'skipped', `Expected skipped, got: ${states[0].state}`);
  console.log('✓ getWindowStates (skipped) passed');
}

function testGetCountdown() {
  const config = { startTime: '23:59', windowCount: 1, windowDuration: 1 };
  const result = StatusService.getCountdown(config);
  console.assert(typeof result === 'string', 'Countdown is a string');
  console.log(`✓ getCountdown returned: "${result}"`);
}

testGetWindowTimes4();
testGetWindowTimes2();
testGetWindowStatesNoLogs();
testGetWindowStatesStarted();
testGetWindowStatesSkipped();
testGetCountdown();
