const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

function solo(t) {
  const c = client(relay());
  t.after(() => c.close());
  const buzzes = [];
  c.context.navigator.vibrate = (p) => { buzzes.push(JSON.parse(JSON.stringify(p))); return true; };
  return { c, buzzes };
}

test('haptics follow the switch, and the strength scales how long the motor runs but never the rhythm', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = true; settings.hapticsStrength = 1; settings.hapticsSaver = true; batteryLow = false;');
  c.run("buzz('heavy'); buzz('success')");
  assert.deepEqual(buzzes, [18, [10, 28, 10]]);
  buzzes.length = 0;
  c.run('settings.hapticsStrength = 0.5');
  c.run("buzz('heavy'); buzz('success')");
  assert.deepEqual(buzzes, [9, [5, 28, 5]], 'shorter pulses, same gaps between them');
  buzzes.length = 0;
  c.run('settings.hapticsStrength = 0.3');
  c.run("buzz('select')");
  assert.deepEqual(buzzes, [4], 'never shorter than the motor can play');
  buzzes.length = 0;
  c.run('settings.haptics = false');
  c.run("buzz('heavy')");
  assert.deepEqual(buzzes, [], 'off means off');
});

test('a low, unplugged battery quiets the buzz when the saver is on, and only then', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = true; settings.hapticsStrength = 1; batteryLow = true; settings.hapticsSaver = true;');
  c.run("buzz('heavy')");
  assert.deepEqual(buzzes, [], 'saver on + low battery: silent');
  c.run('settings.hapticsSaver = false');
  c.run("buzz('heavy')");
  assert.deepEqual(buzzes, [18], 'saver off: the player asked for it');
  buzzes.length = 0;
  c.run('settings.hapticsSaver = true; batteryLow = false');
  c.run("buzz('heavy')");
  assert.deepEqual(buzzes, [18], 'battery fine: normal');
});

test('the battery watcher flips the saver as the level and charger change', async (t) => {
  const listeners = {};
  const battery = { charging: false, level: 0.5, addEventListener: (n, f) => { listeners[n] = f; } };
  const c = client(relay(), { navigator: { getBattery: () => Promise.resolve(battery) } });
  t.after(() => c.close());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.run('batteryLow'), false);
  battery.level = 0.15; listeners.levelchange();
  assert.equal(c.run('batteryLow'), true, 'low and unplugged');
  battery.charging = true; listeners.chargingchange();
  assert.equal(c.run('batteryLow'), false, 'plugged in again');
});

test('turning haptics on lets you feel it, and the saver row only shows where the battery can be read', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = false; settings.hapticsStrength = 1; batteryLow = false;');
  c.run("toggleSetting('haptics')");
  assert.deepEqual(buzzes, [[10, 28, 10]], 'a confirmation buzz');
  c.run("toggleSetting('haptics')");
  assert.equal(buzzes.length, 1, 'switching off is silent');
  const host = c.context.document.createElement('div');
  c.run('navigator.getBattery = undefined');
  assert.equal(c.run('SETTINGS_DEF.some((d) => d.needsBattery)'), true);
  assert.ok(c.run('SETTINGS_DEF.find((d) => d.key === "hapticsStrength").min') === 0.3);
});

test('saved haptic settings are kept, and corrupt ones fall back to sane values', (t) => {
  const c = client(relay(), { storage: new Map([['sm2.settings', JSON.stringify({ hapticsStrength: 'loud', hapticsSaver: 0 })]]) });
  t.after(() => c.close());
  assert.equal(c.run('settings.hapticsStrength'), 1);
  assert.equal(c.run('settings.hapticsSaver'), true);
  const d = client(relay(), { storage: new Map([['sm2.settings', JSON.stringify({ hapticsStrength: 0.1, hapticsSaver: false })]]) });
  t.after(() => d.close());
  assert.equal(d.run('settings.hapticsStrength'), 0.3, 'clamped to the floor');
  assert.equal(d.run('settings.hapticsSaver'), false);
});
