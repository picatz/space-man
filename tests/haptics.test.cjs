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
  assert.deepEqual(buzzes, [18, [15, 28, 15]]);
  buzzes.length = 0;
  c.run('settings.hapticsStrength = 0.5');
  c.run("buzz('heavy'); buzz('success')");
  assert.deepEqual(buzzes, [15, [15, 28, 15]], 'shorter pulses (floored at what a phone motor can render), same gaps between them');
  buzzes.length = 0;
  c.run('settings.hapticsStrength = 0.3');
  c.run("buzz('select')");
  assert.deepEqual(buzzes, [15], 'never shorter than the motor can play');
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
  battery.level = 0.2; listeners.levelchange();
  assert.equal(c.run('batteryLow'), false, 'exactly 20% is not below 20%');
  battery.level = 0.19; listeners.levelchange();
  assert.equal(c.run('batteryLow'), true, 'low and unplugged');
  battery.charging = true; listeners.chargingchange();
  assert.equal(c.run('batteryLow'), false, 'plugged in again');
});

test('turning haptics on lets you feel it, and switching off is silent', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = false; settings.hapticsStrength = 1; batteryLow = false;');
  c.run("toggleSetting('haptics')");
  assert.deepEqual(buzzes, [[15, 28, 15]], 'a confirming buzz');
  c.run("toggleSetting('haptics')");
  assert.deepEqual(buzzes.slice(1), [0], 'switching off makes no buzz and cuts any pulse still running');
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

test('letting go of the strength slider feels the new strength, once, at that strength', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = true; settings.hapticsSaver = false');
  const host = c.context.document.createElement('div');
  c.context.__host = host;
  c.run('hapticRows.length = 0; buildSettings(__host)');
  const row = host.children.find((r) => r.dataset.settingRow === 'hapticsStrength');
  const range = row.children.find((x) => x.type === 'range');
  assert.equal(range.min, 30);
  assert.equal(range.max, 100);
  range.valueAsNumber = 50; range.oninput();                   // dragging: the value moves, nothing buzzes
  assert.equal(c.run('settings.hapticsStrength'), 0.5);
  assert.deepEqual(buzzes, []);
  range.onchange();                                            // letting go: one confirming buzz at the new strength
  assert.deepEqual(buzzes, [[15, 28, 15]]);
});

test('swapping or unplugging controllers keeps the strength row honest, without waiting for a connect event', (t) => {
  let pads = [];
  const c = client(relay(), { navigator: { getGamepads: () => pads } });
  t.after(() => c.close());
  const host = c.context.document.createElement('div');
  c.context.__host = host;
  c.run('hapticRows.length = 0; buildSettings(__host)');
  const row = host.children.find((r) => r.dataset.settingRow === 'hapticsStrength');
  const shown = () => row.style.display !== 'none';
  const rumble = { vibrationActuator: { playEffect: () => Promise.resolve() } };
  const plain = {};
  const pad = (extra) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), ...extra });
  assert.equal(shown(), false);
  pads = [pad(rumble)]; c.run('input.pad.index = 0; pollGamepad()');
  assert.equal(shown(), true, 'a rumbling controller');
  pads = [pad(plain)]; c.run('pollGamepad()');
  assert.equal(shown(), false, 'swapped for one that cannot rumble, with no disconnect in between');
  pads = [pad({ vibrationActuator: { pulse() {} } })]; c.run('pollGamepad()');
  assert.equal(shown(), false, 'an actuator that cannot play effects does not count as rumble');
  pads = [pad({ hapticActuators: [{ playEffect: () => Promise.resolve() }] })]; c.run('pollGamepad()');
  assert.equal(shown(), true, 'swapped for a pad whose rumble is the older hapticActuators kind');
  pads = [pad({ vibrationActuator: { pulse() {} } })]; c.run('pollGamepad()');
  assert.equal(shown(), false, 'and back to one without effects');
  pads = [pad(rumble)]; c.run('pollGamepad()');
  assert.equal(shown(), true, 'and back');
  pads = []; c.run('input.pad.index = -1; pollGamepad()');
  assert.equal(shown(), false, 'unplugged');
});

test('the iOS tick input is a real switch, or WebKit never plays its haptic', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<label class="hap" id="hapLbl"[^>]*><input type="checkbox" switch /);
});

test('on an iPhone the jump/fire side gets a real-tap haptic overlay during a live run, and only then', () => {
  const c = client(relay());
  try {
    c.run('iosTapHaptics = true'); c.run('settings.haptics = true; settings.lefty = false');
    const shown = () => c.run("document.getElementById('hapTouch').style.display");
    c.run("G.mode = 'attract'; tickTouchHaptic()");
    assert.notEqual(shown(), 'block', 'not on the title screen');
    c.run("G.mode = 'play'; tickTouchHaptic()");
    assert.equal(shown(), 'block');
    assert.equal(c.run("document.getElementById('hapTouch').style.left"), '45%', 'the side away from the stick');
    c.run('settings.lefty = true; tickTouchHaptic()');
    assert.equal(c.run("document.getElementById('hapTouch').style.left"), '0');
    c.run('settings.haptics = false; tickTouchHaptic()');
    assert.equal(shown(), 'none', 'off means off: the overlay is gone and taps are plain taps');
    c.run('settings.haptics = true; iosTapHaptics = false; hapticOverlayKey = "x"; tickTouchHaptic()');
    assert.equal(shown(), 'none', 'a phone with a motor (or a desktop) never gets it');
  } finally { c.close(); }
});

test('the overlay feeds the same handlers as the canvas and never steals the native click', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /el\.addEventListener\('pointerdown', onTapDown/);
  assert.match(html, /el\.addEventListener\('pointermove', onTapMove/);
  assert.match(html, /if \(onCanvas\) e\.preventDefault\(\)/, 'only the canvas path prevents default: a prevented pointerdown may swallow the click iOS needs');
  assert.match(html, /<label class="hap-touch" id="hapTouch"[^>]*><input type="checkbox" switch/);
});

test('the iPhone settings get a test tick that does not exist on other devices', () => {
  const c = client(relay());
  try {
    const host = c.context.document.createElement('div'); c.context.__host = host;
    c.run('iosTapHaptics = false; buildSettings(__host)');
    assert.equal(host.children.some((r) => /haptic-test/.test(r.className)), false);
    const host2 = c.context.document.createElement('div'); c.context.__host2 = host2;
    c.run('iosTapHaptics = true; buildSettings(__host2)');
    assert.equal(host2.children.some((r) => /haptic-test/.test(r.className)), true);
  } finally { c.close(); }
});

test('death, a new sector, an unlock and a finished mission each have a haptic; every control gives a light tap', (t) => {
  const { c, buzzes } = solo(t);
  c.run('settings.haptics = true; settings.hapticsStrength = 1; settings.hapticsSaver = false; iosTapHaptics = false; batteryLow = false;');
  c.run("startRun(); die('flare')");
  assert.ok(buzzes.some((b) => Array.isArray(b) && b[0] >= 30), 'the hit you feel');
  buzzes.length = 0;
  c.run("unlockCosmetic('catears')");
  assert.deepEqual(buzzes, [[15, 28, 15]]);
  buzzes.length = 0;
  c.run("buzz('sector'); buzz('tap')");
  assert.equal(buzzes.length, 2);
  buzzes.length = 0;
  c.run('settings.haptics = false');
  c.run("buzz('death'); buzz('tap')");
  assert.deepEqual(buzzes, [], 'off means off, for all of them');
});

test('on an iPhone every control is armed with a tap-haptic overlay that never double-fires its click, and the setting turns it off', () => {
  const c = client(relay());
  try {
    c.run('iosTapHaptics = true');
    const btn = c.context.document.createElement('button'); c.context.__b = btn;
    btn.tagName = 'BUTTON'; btn.closest = () => null; btn.querySelector = () => btn.children.find((x) => /hapt/.test(x.className)) || null;
    btn.className = 'btn';
    c.run('armTapHaptic(__b)');
    const lab = btn.children.find((x) => /hapt/.test(x.className));
    assert.ok(lab, 'overlay added');
    const inp = lab.children[0];
    assert.equal(inp.type, 'checkbox'); assert.ok('switch' in (inp.attrs || {}), 'a real switch');
    let stopped = false; inp.listeners.click[0]({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, "the label's second click is stopped so the control's own handler runs once");
    c.run('armTapHaptic(__b)');
    assert.equal(btn.children.filter((x) => /hapt/.test(x.className)).length, 1, 'idempotent');
    c.run('settings.haptics = false; syncSettingsUI()');
    assert.equal(c.run("document.body.classList.contains('no-haptics')"), true);
  } finally { c.close(); }
});
