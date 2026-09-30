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

test('turning haptics on lets you feel it, and switching off is silent', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = false; settings.hapticsStrength = 1; batteryLow = false;');
  c.run("toggleSetting('haptics')");
  assert.deepEqual(buzzes, [[10, 28, 10]], 'a confirming buzz');
  c.run("toggleSetting('haptics')");
  assert.equal(buzzes.length, 1, 'switching off is silent');
});

// Build the real settings rows into a host and report which haptic rows are on show.
function rows(c) {
  const host = c.context.document.createElement('div');
  c.run('hapticRows.length = 0');
  c.context.__host = host;
  c.run('buildSettings(__host)');
  const byKey = {};
  for (const r of host.children) byKey[r.dataset.settingRow] = r;
  return { byKey, shown: (k) => byKey[k].style.display !== 'none' };
}

test('the strength slider shows only where the motor length can be set, and the saver only once the battery is readable', async (t) => {
  // A laptop: vibrate() exists in Chrome, but there is no motor and no battery access granted.
  const laptop = client(relay(), { navigator: { vibrate() {}, getBattery: () => Promise.reject(new Error('blocked')) } });
  t.after(() => laptop.close());
  await new Promise((r) => setTimeout(r, 10));
  let r = rows(laptop);
  assert.equal(r.shown('hapticsStrength'), false, 'no motor on a laptop');
  assert.equal(r.shown('hapticsSaver'), false, 'battery access was refused: the saver could never do anything');
  assert.equal(r.byKey.hapticsStrength.dataset.settingRow, 'hapticsStrength');

  // An Android phone: touch + vibrate + a readable battery.
  const battery = { charging: false, level: 0.9, addEventListener() {} };
  const phone = client(relay(), { navigator: { vibrate() {}, getBattery: () => Promise.resolve(battery) } });
  t.after(() => phone.close());
  phone.context.matchMedia = (q) => ({ matches: /any-pointer: coarse/.test(q) });
  await new Promise((r2) => setTimeout(r2, 10));
  r = rows(phone);
  assert.equal(r.shown('hapticsStrength'), true);
  assert.equal(r.shown('hapticsSaver'), true);
  assert.equal(phone.run('SETTINGS_DEF.find((d) => d.key === "hapticsStrength").min'), 0.3, 'the slider bottoms out at 30%');

  // An iPhone: touch, no vibrate(), no battery API. The one fixed tick can't be scaled, so no slider, no saver.
  const iphone = client(relay(), { navigator: {} });
  t.after(() => iphone.close());
  iphone.context.matchMedia = (q) => ({ matches: /any-pointer: coarse/.test(q) });
  r = rows(iphone);
  assert.equal(r.shown('hapticsStrength'), false);
  assert.equal(r.shown('hapticsSaver'), false);

  // ...until a controller with rumble is connected, and gone again when it leaves.
  iphone.context.navigator.getGamepads = () => [{ vibrationActuator: { playEffect: () => Promise.resolve() } }];
  iphone.run('input.pad.index = 0; syncHapticRows()');
  assert.equal(rows(iphone).shown('hapticsStrength'), true, 'a rumbling controller makes strength meaningful');
  iphone.run('input.pad.index = -1; syncHapticRows()');
  assert.equal(iphone.run('hapticRows.every((x) => x.style.display === "none")'), true);
});

test('a controller rumbles at the strength you set, for as long as the pattern lasts, and never when off or saving battery', (t) => {
  const plays = [];
  const c = client(relay(), { navigator: { getGamepads: () => [{ vibrationActuator: { playEffect: (type, o) => { plays.push({ type, ...o }); return Promise.resolve(); } } }] } });
  t.after(() => c.close());
  c.run('input.pad.index = 0; settings.haptics = true; settings.hapticsSaver = true; batteryLow = false');
  const round = (o) => ({ type: o.type, duration: o.duration, strong: Math.round(o.strongMagnitude * 1000) / 1000, weak: Math.round(o.weakMagnitude * 1000) / 1000 });

  c.run('settings.hapticsStrength = 1');
  c.run("buzz('heavy')");
  assert.deepEqual(round(plays.pop()), { type: 'dual-rumble', duration: 36, strong: 0.65, weak: 0.38 });
  c.run("buzz('select')");
  assert.deepEqual(round(plays.pop()), { type: 'dual-rumble', duration: 20, strong: 0.24, weak: 0.18 }, 'light taps are gentler than heavy hits');

  c.run('settings.hapticsStrength = 0.3');
  c.run("buzz('heavy')");
  assert.deepEqual(round(plays.pop()), { type: 'dual-rumble', duration: 36, strong: 0.195, weak: 0.114 }, 'same duration, less force');

  c.run('settings.hapticsStrength = 1; batteryLow = true');
  c.run("buzz('heavy')");
  assert.equal(plays.length, 0, 'low battery + saver: the controller stays quiet too');
  c.run('batteryLow = false; settings.haptics = false');
  c.run("buzz('heavy')");
  assert.equal(plays.length, 0, 'off is off');
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
