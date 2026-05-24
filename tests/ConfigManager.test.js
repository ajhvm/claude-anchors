const ConfigManager = require('../src/services/ConfigManager');

function testConfigLoad() {
  const cm = new ConfigManager();
  const config = cm.load();
  console.assert(config.version === 2, `Config is version 2, got: ${config.version}`);
  console.assert(config.startTime, 'Config has startTime');
  console.assert(typeof config.windowCount === 'number', 'Config has windowCount');
  console.assert(typeof config.windowDuration === 'number', 'Config has windowDuration');
  console.assert(config.windowDurationSource, 'Config has windowDurationSource');
  console.assert(typeof config.prompt === 'string', 'Config has prompt string');
  console.log('✓ Config load test passed');
}

function testConfigSave() {
  const cm = new ConfigManager();
  const original = cm.load();
  const testConfig = { ...original, timezone: 'America/New_York', _test: true };
  const saved = cm.save(testConfig);
  console.assert(saved, 'Config saved successfully');
  const loaded = cm.load();
  console.assert(loaded._test === true, 'Config persisted');
  cm.save(original);
  console.log('✓ Config save test passed');
}

function testMigrateV1toV2() {
  const cm = new ConfigManager();
  const original = cm.load();
  const v1 = {
    version: 1,
    timezone: 'America/Chicago',
    isPaused: false,
    schedule: { monday: { w1Primary: '06:00', w1Backup: '06:15' } },
    prompts: { w1Primary: 'Custom prompt.' }
  };
  const v2 = cm.migrateV1toV2(v1);
  console.assert(v2.version === 2, 'Migrated to version 2');
  console.assert(v2.startTime === '06:00', `startTime from w1Primary, got: ${v2.startTime}`);
  console.assert(v2.prompt === 'Custom prompt.', `prompt from w1Primary, got: ${v2.prompt}`);
  console.assert(v2.windowCount === 4, 'Default windowCount is 4');
  console.assert(!v2.schedule, 'No schedule in v2 config');
  cm.save(original);
  console.log('✓ migrateV1toV2 test passed');
}

testConfigLoad();
testConfigSave();
testMigrateV1toV2();
