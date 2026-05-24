const fs = require('fs');
const os = require('os');
const path = require('path');
const AnchorRunner = require('../src/services/AnchorRunner');
const LogReader = require('../src/services/LogReader');

// Fake ConfigManager pointing logs at a throwaway temp dir.
function makeFakeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-test-'));
  return {
    dir,
    getLogsDir: () => dir,
    load: () => ({ prompt: 'New context window open. Reply OK only.' })
  };
}

function readEntries(dir, anchor) {
  const content = fs.readFileSync(path.join(dir, `${anchor}.log`), 'utf-8');
  return new LogReader().parseLogFile(content, `${anchor}.log`);
}

async function testFireSuccess() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => cb(null, 'OK\n', '');
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w1');
  console.assert(res.ok === true, `fire ok=true, got ${res.ok}`);
  console.assert(res.reply === 'OK', `reply 'OK', got '${res.reply}'`);
  const entries = readEntries(cfg.dir, 'w1');
  console.assert(entries.length === 1, `1 log entry, got ${entries.length}`);
  console.assert(entries[0].status === 'ok', `status ok, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.fire success passed');
}

async function testFireFailure() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => cb(new Error('claude not found'), '', '');
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w2');
  console.assert(res.ok === false, `fire ok=false, got ${res.ok}`);
  const entries = readEntries(cfg.dir, 'w2');
  console.assert(entries[0].status === 'error', `status error, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.fire failure passed');
}

function testLogSkipped() {
  const cfg = makeFakeConfig();
  const runner = new AnchorRunner(cfg, () => {});
  runner.logSkipped('w3');
  const entries = readEntries(cfg.dir, 'w3');
  console.assert(entries[0].status === 'skipped', `status skipped, got ${entries[0].status}`);
  console.log('✓ AnchorRunner.logSkipped passed');
}

function testTimestampFormat() {
  const runner = new AnchorRunner({ getLogsDir: () => '.', load: () => ({}) }, () => {});
  const ts = runner._timestamp(new Date(2026, 4, 24, 5, 3, 9)); // May=4
  console.assert(ts === '2026-05-24 05:03:09', `timestamp format, got '${ts}'`);
  console.log('✓ AnchorRunner._timestamp passed');
}

(async () => {
  await testFireSuccess();
  await testFireFailure();
  testLogSkipped();
  testTimestampFormat();
})();
