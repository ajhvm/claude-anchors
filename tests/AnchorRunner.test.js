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

function cleanup(cfg) {
  try { fs.rmSync(cfg.dir, { recursive: true, force: true }); } catch {}
}

async function testFireSuccess() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => {
    console.assert(opts.windowsHide === true, 'windowsHide must be true');
    console.assert(opts.timeout === 60000, `timeout must be 60000, got ${opts.timeout}`);
    cb(null, 'OK\n', '');
  };
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w1');
  console.assert(res.ok === true, `fire ok=true, got ${res.ok}`);
  console.assert(res.reply === 'OK', `reply 'OK', got '${res.reply}'`);
  const entries = readEntries(cfg.dir, 'w1');
  console.assert(entries.length === 1, `1 log entry, got ${entries.length}`);
  console.assert(entries[0].status === 'ok', `status ok, got ${entries[0].status}`);
  cleanup(cfg);
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
  cleanup(cfg);
  console.log('✓ AnchorRunner.fire failure passed');
}

async function testFireEmptyResponse() {
  const cfg = makeFakeConfig();
  const fakeExec = (cmd, args, opts, cb) => cb(null, '   ', '');
  const runner = new AnchorRunner(cfg, fakeExec);
  const res = await runner.fire('w2');
  console.assert(res.ok === false, `empty response ok=false, got ${res.ok}`);
  console.assert(res.reply === '', `empty reply '', got '${res.reply}'`);
  const entries = readEntries(cfg.dir, 'w2');
  console.assert(entries[0].status === 'error', `empty logs error, got ${entries[0].status}`);
  cleanup(cfg);
  console.log('✓ AnchorRunner.fire empty-response passed');
}

// Verifies the Critical fix: the real execFile callback is async, so a throw
// inside it (here: log write to a non-existent dir) must be caught and resolve,
// NOT crash the process with an uncaught exception.
async function testFireSurvivesLogWriteError() {
  const badCfg = {
    getLogsDir: () => path.join(os.tmpdir(), 'anchors-no-such-dir-xyz', 'nested'),
    load: () => ({ prompt: 'x' })
  };
  const asyncExec = (cmd, args, opts, cb) => setImmediate(() => cb(null, 'OK\n', ''));
  const runner = new AnchorRunner(badCfg, asyncExec);
  const res = await runner.fire('w1');
  console.assert(res.ok === false, `log-write error → ok=false, got ${res.ok}`);
  console.log('✓ AnchorRunner.fire survives log-write error passed');
}

function testLogSkipped() {
  const cfg = makeFakeConfig();
  const runner = new AnchorRunner(cfg, () => {});
  runner.logSkipped('w3');
  const entries = readEntries(cfg.dir, 'w3');
  console.assert(entries[0].status === 'skipped', `status skipped, got ${entries[0].status}`);
  cleanup(cfg);
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
  await testFireEmptyResponse();
  await testFireSurvivesLogWriteError();
  testLogSkipped();
  testTimestampFormat();
})();
