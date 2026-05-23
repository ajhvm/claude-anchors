const ConfigManager = require('../src/services/ConfigManager');

function testConfigLoad() {
  const cm = new ConfigManager();
  const config = cm.load();
  console.assert(config.timezone, 'Config has timezone');
  console.assert(config.schedule, 'Config has schedule');
  console.log('✓ Config load test passed');
}

function testConfigSave() {
  const cm = new ConfigManager();
  const original = cm.load();
  const testConfig = { ...original, timezone: 'America/New_York', test: true };
  const saved = cm.save(testConfig);
  console.assert(saved, 'Config saved successfully');
  const loaded = cm.load();
  console.assert(loaded.test === true, 'Config persisted');
  // Restore original config so this test doesn't pollute subsequent runs
  cm.save(original);
  console.log('✓ Config save test passed');
}

testConfigLoad();
testConfigSave();
