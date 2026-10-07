const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

function solo(t, opts) {
  const hub = relay(), c = client(hub, opts);
  t.after(() => c.close());
  return { hub, c };
}
const key = (k) => ({ key: k, preventDefault() {} });
const REST = { down: 's', dash: 'shift', rescue: 'r', camera: 'c', pause: 'p', mute: 'm' };   // the shared actions beyond the four runner keys
const DEF = { left: 'a', right: 'd', jump: 'w', fire: 'f', ...REST };

test('reduce motion gates screen shake and the hit-punch zoom live', (t) => {
  const { c } = solo(t);
  c.run('startRun(); G.mode = "play"; settings.shake = true; settings.reduceMotion = false;');
  const shake = () => c.run('G.trauma = 1; G.time = 3; G.kickAt = 0; G.deathCardShown = false; computeShake(); Math.abs(G.shake.x) + Math.abs(G.shake.y)');
  assert.ok(shake() > 0, 'shake runs with reduce motion off');
  const scales = [];
  c.run('ctx').scale = (x) => scales.push(x);
  c.run('G.punchZoom = 1.05; render(1);');
  assert.ok(scales.includes(1.05), 'punch zoom applied with reduce motion off');

  c.run('toggleSetting("reduceMotion")');
  assert.equal(c.run('settings.reduceMotion'), true);
  assert.equal(c.run('document.body.classList.contains("reduce-motion")'), true);
  assert.equal(shake(), 0, 'shake gated the moment the switch flips');
  scales.length = 0;
  c.run('G.punchZoom = 1.05; render(1);');
  assert.ok(!scales.includes(1.05), 'punch zoom dropped');
  assert.ok(scales.includes(1));
  assert.match(c.elements.get('srAnnounce').textContent, /Reduce motion on/);
});

test('reduce motion + key map persist, and garbage saves sanitize to defaults', (t) => {
  const storage = new Map();
  const { hub, c } = solo(t, { storage });
  assert.equal(c.run('settings.reduceMotion'), false, 'defaults to the OS query (false here)');
  assert.deepEqual({ ...c.run('settings.keys') }, DEF);
  c.run('toggleSetting("reduceMotion"); beginRebind("jump", "Jump"); rebindKey("e"); beginRebind("left", "Move left"); rebindKey("d");');
  assert.deepEqual({ ...c.run('settings.keys') }, { left: 'd', right: 'a', jump: 'e', fire: 'f', ...REST }, 'a taken key swaps, never duplicates');

  const again = client(hub, { storage });
  t.after(() => again.close());
  assert.equal(again.run('settings.reduceMotion'), true);
  assert.deepEqual({ ...again.run('settings.keys') }, { left: 'd', right: 'a', jump: 'e', fire: 'f', ...REST });
  again.run('onKey({ key: "E", preventDefault() {} }, true)');
  assert.equal(again.run('input.jumpPressed'), true, 'rebound jump key drives the run');
  again.run('onKey({ key: "d", preventDefault() {} }, true)');
  assert.equal(again.run('input.left'), true);
  assert.equal(again.run('rebinding = "fire"; rebindKey("escape")'), false, 'reserved keys are refused');
  again.run('resetKeys()');
  assert.deepEqual({ ...again.run('settings.keys') }, DEF);

  for (const bad of [{ reduceMotion: 'yes', keys: { left: 'escape', right: 5 } }, { keys: { left: 'a', right: 'a' } }, { keys: 'wasd' }]) {
    const s = new Map([['sm2.settings', JSON.stringify(bad)]]);
    const g = client(hub, { storage: s });
    t.after(() => g.close());
    assert.equal(g.run('settings.reduceMotion'), false);
    assert.deepEqual({ ...g.run('settings.keys') }, DEF);
  }
  assert.equal(c.run('SpaceManSave.migrate({ settings: {} }, { reduceMotion: true }).settings.reduceMotion'), true, 'OS default flows through the schema');
  assert.equal(c.run('SpaceManSave.migrate({ settings: { reduceMotion: false } }, { reduceMotion: true }).settings.reduceMotion'), false, 'an explicit choice beats the OS');
});

function fakeButton(doc, y, onclick) {
  return { y, clicks: 0, disabled: false, getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 100, top: y, width: 200, height: 40 }),
    focus() { doc.activeElement = this; }, click() { this.clicks++; if (onclick) onclick(); } };
}
function gamepad() {
  return { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}

test('gamepad navigates menu focus, activates, and backs out without touching runs', (t) => {
  const { c } = solo(t);
  const doc = c.context.document, pad = gamepad();
  c.context.navigator.getGamepads = () => [pad];
  const tap = (i) => { pad.buttons[i].pressed = true; c.run('pollGamepad()'); pad.buttons[i].pressed = false; c.run('pollGamepad()'); };

  c.run('openSettings("attract")');
  const items = [fakeButton(doc, 100), fakeButton(doc, 160), fakeButton(doc, 220)];
  Object.assign(doc.getElementById('ovSettings'), { querySelectorAll: () => items, contains: (el) => items.includes(el) });
  const back = doc.getElementById('btnCloseSettings');
  Object.assign(back, { getClientRects: () => [1], click() { this.onclick(); } });
  c.run('pollGamepad()');   // connect
  assert.equal(c.run('topOverlayId()'), 'ovSettings');

  tap(0);   // A with nothing focused: focuses, never starts a run from a sub-menu
  assert.equal(doc.activeElement, items[0]);
  assert.equal(c.run('G.mode'), 'attract');
  tap(13); assert.equal(doc.activeElement, items[1], 'D-pad down moves focus');
  tap(13); tap(13); assert.equal(doc.activeElement, items[0], 'wraps past the last control');
  tap(12); assert.equal(doc.activeElement, items[2], 'D-pad up wraps back');
  pad.axes[1] = -1; c.run('pollGamepad()'); pad.axes[1] = 0; c.run('pollGamepad()');
  assert.equal(doc.activeElement, items[1], 'stick moves focus too');
  tap(0);
  assert.equal(items[1].clicks, 1, 'A activates the focused control');
  tap(1);
  assert.equal(c.run('topOverlayId()'), 'ovAttract', 'B closes the sub-menu');

  // In a run there is no overlay: D-pad/A stay pure gameplay.
  c.run('startRun(); hideAllOverlays(); G.mode = "play"; input.jumpPressed = false;');
  doc.activeElement = null;
  tap(13);
  assert.equal(doc.activeElement, null);
  pad.buttons[0].pressed = true; c.run('pollGamepad()');
  assert.equal(c.run('input.jumpPressed'), true);
  pad.buttons[0].pressed = false; c.run('pollGamepad()');

  // Start pauses; B resumes from the pause card.
  tap(9); assert.equal(c.run('G.mode'), 'pause');
  tap(1); assert.notEqual(c.run('G.mode'), 'pause');
});

test('Escape closes sub-menus before it would pause', (t) => {
  const { c } = solo(t);
  c.run('showTrophy()');
  const back = c.context.document.getElementById('btnCloseTrophy');
  Object.assign(back, { getClientRects: () => [1], click() { this.onclick(); } });
  assert.equal(c.run('topOverlayId()'), 'ovTrophy');
  c.context.onKey(key('Escape'), true);
  assert.equal(c.run('topOverlayId()'), 'ovAttract');
});

test('run over is announced with score and distance; moments are rate-limited', (t) => {
  const { hub, c } = solo(t);
  const said = () => c.elements.get('srAnnounce').textContent;
  c.run('startRun(); G.mode = "play"; G.prevBest = 0; G.score = 1234; G.dist = 940; die("void"); showDeathCard();');
  assert.match(said(), /^Run over: 1,234 points, 940 meters\./);
  assert.doesNotMatch(said(), /personal best/, 'a first-ever run is not narrated as beating a best');

  c.run('startRun(); G.mode = "play"; G.prevBest = 500; G.score = 900; G.dist = 300; die("void"); showDeathCard();');
  assert.match(said(), /^Run over: 900 points, 300 meters\. New personal best!/);

  assert.match(said(), /Bronze medal\.$/);
  c.run('G.mode = "play"; announceMoment("Sector 2: ion drift.")');
  assert.match(said(), /^Run over/, 'a run-over line is never trampled by an in-run moment right after');
  hub.advance(4100);
  c.run('announceMoment("Sector 2: ion drift.")');
  assert.equal(said(), 'Sector 2: ion drift.');
  c.run('announceMoment("Mission complete.")');
  assert.equal(said(), 'Sector 2: ion drift.', 'second moment inside 4s is dropped');
  hub.advance(4100);
  c.run('announceMoment("Mission complete.")');
  assert.equal(said(), 'Mission complete.');
});

test('the game canvas is exposed to assistive tech as a labelled image', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<canvas id="game" role="img" aria-label="[^"]+">/);
});

test('Space is game-owned: never bindable, and a saved Space binding falls back', (t) => {
  const { hub, c } = solo(t);
  assert.equal(c.run('SpaceManSave.bindableKey(" ")'), false);
  assert.equal(c.run('rebinding = "fire"; rebindKey(" ")'), false);
  assert.equal(c.run('settings.keys.fire'), 'f', 'refused key leaves the map untouched');
  const g = client(hub, { storage: new Map([['sm2.settings', JSON.stringify({ keys: { left: 'a', right: 'd', jump: ' ', fire: 'f' } })]]) });
  t.after(() => g.close());
  assert.deepEqual({ ...g.run('settings.keys') }, DEF);
});

test('Start and Space never start a run from under a sub-menu', (t) => {
  const { c } = solo(t);
  const doc = c.context.document, pad = gamepad();
  c.context.navigator.getGamepads = () => [pad];
  const tap = (i) => { pad.buttons[i].pressed = true; c.run('pollGamepad()'); pad.buttons[i].pressed = false; c.run('pollGamepad()'); };
  Object.assign(doc.getElementById('btnCloseSettings'), { getClientRects: () => [1], click() { this.onclick(); } });
  c.run('pollGamepad()');   // connect

  c.run('openSettings("attract")');
  c.context.onKey(key(' '), true);
  c.context.onKey(key('Enter'), true);
  assert.equal(c.run('G.mode'), 'attract', 'keyboard start keys are inert under Settings');
  assert.equal(c.run('topOverlayId()'), 'ovSettings');
  tap(9);
  assert.equal(c.run('G.mode'), 'attract', 'Start does not dump the player into a run');
  assert.equal(c.run('topOverlayId()'), 'ovAttract', 'Start closes the sub-menu instead');
  tap(9);
  assert.notEqual(c.run('G.mode'), 'attract', 'on the title card itself Start still starts');

  c.run('G.mode = "play"; togglePause(); openSettings("pause")');
  tap(9);
  assert.equal(c.run('G.mode'), 'pause', 'Start over Settings-from-pause returns to the pause card');
  assert.equal(c.run('topOverlayId()'), 'ovPause');
});

test('a qualifying run is announced immediately, not after the initials picker', (t) => {
  const { c } = solo(t);
  c.run('top5 = [1, 2, 3, 4, 5].map((n) => ({ initials: "AAA", score: n * 10, dist: 1, chain: 1 }));');
  c.run('startRun(); G.mode = "play"; G.prevBest = 50; G.score = 900; G.dist = 300; die("void"); showDeathCard();');
  assert.equal(c.run('G.showPicker'), true);
  assert.equal(c.run('topOverlayId()'), 'ovInitials');
  assert.match(c.elements.get('srAnnounce').textContent, /^Run over: 900 points, 300 meters\. New personal best!.* New high score: enter your initials\.$/);
});

test('touch-only (not hybrid) hides key rows; the motion switch owns the CSS class', (t) => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /@media \(pointer: coarse\) and \(not \(any-pointer: fine\)\) \{ \.key-row \{ display: none; \} \}/);
  assert.doesNotMatch(html, /@media \(pointer: coarse\) \{ \.key-row/);
  assert.doesNotMatch(html, /@media \(prefers-reduced-motion/, 'the OS query only seeds the default; it cannot override the switch');
  const { c } = solo(t);
  assert.equal(c.run('document.body.classList.contains("reduce-motion")'), false);
  c.run('toggleSetting("reduceMotion")');
  assert.equal(c.run('document.body.classList.contains("reduce-motion")'), true);
  c.run('toggleSetting("reduceMotion")');
  assert.equal(c.run('document.body.classList.contains("reduce-motion")'), false, 'switching off restores motion');
});

test('canvas toasts reach the live region (controller disconnect) and gold toasts are throttled', (t) => {
  const { c } = solo(t);
  const doc = c.context.document, pad = gamepad();
  c.context.navigator.getGamepads = () => [pad];
  c.run('var __t = 1000; frame(__t); startRun(); hideAllOverlays(); G.mode = "play"; G.deathCardShown = false;');
  c.run('pollGamepad()');   // connect
  c.context.navigator.getGamepads = () => [];
  c.run('pollGamepad()');   // vanishes
  c.run('G.toastT = 0; __t += 16; frame(__t)');
  assert.equal(doc.getElementById('srAnnounce').textContent, 'CONTROLLER DISCONNECTED');
  c.run('G.toastT = 0; queueToast("HELLO OUT THERE", "gold"); __t += 16; frame(__t)');
  assert.equal(doc.getElementById('srAnnounce').textContent, 'CONTROLLER DISCONNECTED', 'a gold toast inside the 4s window does not chatter');
});

test('Text size cycles 1 / 1.15 / 1.3, drives --ui-scale and the canvas HUD scale, persists and sanitizes', (t) => {
  const storage = new Map();
  const { hub, c } = solo(t, { storage });
  const calls = [];
  c.context.document.documentElement.style.setProperty = (k, v) => calls.push([k, v]);
  assert.equal(c.run('settings.uiScale'), 1);
  assert.equal(c.run('SETTINGS_DEF.find((d) => d.key === "uiScale").noShot'), true, 'the row stays out of the #shot goldens');
  c.run('view.w = 560');
  const base = c.run('uiScale()');
  c.run('cycleTextScale()');
  assert.equal(c.run('settings.uiScale'), 1.15);
  assert.deepEqual(calls.pop(), ['--ui-scale', '1.15']);
  assert.match(c.elements.get('srAnnounce').textContent, /Text size Large/);
  assert.ok(Math.abs(c.run('uiScale()') - base * 1.15) < 1e-9, 'the canvas HUD scale follows the setting');
  c.run('cycleTextScale()');
  assert.equal(c.run('settings.uiScale'), 1.3);
  c.run('cycleTextScale()');
  assert.equal(c.run('settings.uiScale'), 1, 'wraps back to normal');
  c.run('cycleTextScale()');

  const again = client(hub, { storage });
  t.after(() => again.close());
  assert.equal(again.run('settings.uiScale'), 1.15, 'persisted');
  for (const bad of [0.2, 9, '1.3', null, 1.2]) {
    assert.equal(c.run(`SpaceManSave.migrate({ settings: { uiScale: ${JSON.stringify(bad)} } }).settings.uiScale`), 1, 'invalid sizes fall back: ' + bad);
  }
  assert.equal(c.run('SpaceManSave.migrate({ settings: { uiScale: 1.3 } }).settings.uiScale'), 1.3);
});

test('pause, mute, drop, camera, dash and rescue are rebindable and drive the runner', (t) => {
  const { c } = solo(t);
  c.run('startRun(); hideAllOverlays(); G.mode = "play"; G.deathCardShown = false;');
  c.run('beginRebind("pause", "Pause"); rebindKey("o"); beginRebind("mute", "Mute"); rebindKey("n"); beginRebind("down", "Drop"); rebindKey("z");');
  assert.deepEqual({ ...c.run('settings.keys') }, { ...DEF, pause: 'o', mute: 'n', down: 'z' });
  assert.equal(c.run('settings.muted'), false);
  c.run('onKey({ key: "n", preventDefault() {} }, true)');
  assert.equal(c.run('settings.muted'), true, 'the rebound mute key toggles audio');
  c.run('onKey({ key: "m", preventDefault() {} }, true)');
  assert.equal(c.run('settings.muted'), true, 'the old M key no longer mutes');
  c.run('onKey({ key: "z", preventDefault() {} }, true)');
  assert.equal(c.run('input.down'), true, 'the rebound drop key lets go of a ledge');
  c.run('onKey({ key: "z", preventDefault() {} }, false)');
  c.run('onKey({ key: "p", preventDefault() {} }, true)');
  assert.equal(c.run('G.mode'), 'play', 'the old P key no longer pauses');
  c.run('onKey({ key: "o", preventDefault() {} }, true)');
  assert.equal(c.run('G.mode'), 'pause', 'the rebound pause key pauses');
  c.run('onKey({ key: "escape", preventDefault() {} }, true)');
  assert.equal(c.run('G.mode'), 'play', 'Escape stays an always-on pause toggle');

  // Dash / rescue / camera take keys the runner never uses as moves; a swap never duplicates.
  c.run('beginRebind("dash", "Dash"); rebindKey("x");');
  assert.equal(c.run('settings.keys.dash'), 'x');
  assert.equal(c.run('settings.keys.fire'), 'f');
  c.run('input.shoot = false; onKey({ key: "x", preventDefault() {} }, true)');
  assert.equal(c.run('input.shoot'), false, 'a key bound to dash is not the runner x-fire alternate');
  c.run('beginRebind("camera", "Camera"); rebindKey("a");');
  assert.equal(c.run('settings.keys.camera'), 'a');
  assert.equal(c.run('settings.keys.left'), 'c', 'a taken key swaps');
  // Rescue starts on R, which the runner owns for restart: it can be moved but nothing can swap onto R.
  assert.equal(c.run('beginRebind("left", "Move left"); rebindKey("r")'), false, 'R stays reserved');
  assert.equal(c.run('beginRebind("rescue", "Rescue"); rebindKey("c")'), false, 'a swap that would park R on another action is refused');
  assert.equal(c.run('settings.keys.rescue'), 'r');
  c.run('beginRebind("rescue", "Rescue"); rebindKey("q")');
  assert.equal(c.run('settings.keys.rescue'), 'q');
  c.run('beginRebind("rescue", "Rescue"); rebindKey("r")');
  assert.equal(c.run('settings.keys.rescue'), 'r', 'rescue can always return to its own default, R');
  const pause = c.run('settings.keys.pause');
  assert.equal(c.run('beginRebind("pause", "Pause"); rebindKey("r")'), false);
  assert.equal(c.run('settings.keys.pause'), pause, 'no other action may take R');
});

test('saves from before the new actions keep their four keys and get free defaults for the rest', (t) => {
  const { c } = solo(t);
  const mig = (keys) => JSON.parse(c.run(`JSON.stringify(SpaceManSave.migrate({ settings: { keys: ${JSON.stringify(keys)} } }).settings.keys)`));
  assert.deepEqual(mig({ left: 'j', right: 'l', jump: 'i', fire: 'o' }), { left: 'j', right: 'l', jump: 'i', fire: 'o', ...REST });
  const taken = mig({ left: 'a', right: 'd', jump: 'w', fire: 's' });   // s was the fixed drop alternate; the player's fire keeps it
  assert.equal(taken.fire, 's');
  assert.notEqual(taken.down, 's', 'the default drop key moves to a spare instead of duplicating');
  assert.equal(new Set(Object.values(taken)).size, Object.keys(taken).length, 'no duplicates');
  assert.deepEqual(mig({ left: 'a', right: 'd', jump: 'w', fire: 'f', pause: 'escape' }), DEF, 'a reserved key discards the whole map');
  assert.equal(mig({ ...DEF, pause: 'q', mute: 'p' }).mute, 'p', 'P is an ordinary binding now');
});

test('a controller with no standard mapping is announced and still used best-effort', (t) => {
  const { c } = solo(t);
  const doc = c.context.document, pad = { ...gamepad(), mapping: '', id: 'Generic USB Joystick (Vendor: 0079)' };
  c.run('var __t = 1000; frame(__t); startRun(); hideAllOverlays(); G.mode = "play"; G.deathCardShown = false; G.toastT = 0;');
  c.context.navigator.getGamepads = () => [pad];   // plugged in after the game is running
  c.run('toastQ.length = 0; pollGamepad()');
  assert.equal(c.run('input.pad.connected'), true, 'a pad with mapping "" is still picked up');
  assert.deepEqual([...c.run('toastQ.map((q) => q.text)')], ['CONTROLLER NOT STANDARD — BASIC BUTTONS ONLY'], 'one toast says why');
  c.run('G.toastT = 0; __t += 16; frame(__t)');
  assert.match(c.run('G.toast'), /NOT STANDARD/);
  assert.match(doc.getElementById('srAnnounce').textContent, /not standard/i, 'and the screen reader hears it (announce, then the toast mirror)');
  pad.buttons[0].pressed = true; c.run('pollGamepad()');
  assert.equal(c.run('input.jumpPressed'), true, 'button 0 jumps');
  pad.buttons[0].pressed = false; c.run('pollGamepad()');
  c.run('toastQ.length = 0; pollGamepad(); pollGamepad()');
  assert.equal(c.run('toastQ.length'), 0, 'the notice is once per pad, not every poll');
  // A standard pad keeps the ordinary READY toast.
  const { c: d } = solo(t);
  d.run('frame(1000); startRun(); hideAllOverlays(); G.mode = "play"; G.deathCardShown = false; toastQ.length = 0;');
  d.context.navigator.getGamepads = () => [gamepad()];
  d.run('pollGamepad()');
  assert.match(d.run('toastQ[0].text'), /READY/);

// ---- UX-04 / UX-05 / UX-06 / IN-04 / A11Y-06 / A11Y-07 / A11Y-08 ----
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('save schema persists and validates the new Vision and Assists switches', () => {
  const migrate = (s) => {
    const win = { SpaceManCosmetics: { migrateProfile: () => ({}) } };
    new Function('window', read('src/save-schema.js'))(win);
    return win.SpaceManSave.migrate({ settings: s }, {}).settings;
  };
  assert.equal(migrate({}).cbHud, false, 'off by default');
  assert.equal(migrate({}).assistFlare, false, 'assists are off by default so standard play is the default');
  assert.equal(migrate({ cbHud: true, assistFlare: true }).cbHud, true);
  assert.equal(migrate({ cbHud: true, assistFlare: true }).assistFlare, true);
  assert.equal(migrate({ cbHud: 'yes', assistFlare: 1 }).assistFlare, false, 'only literal true counts');
  assert.equal(migrate({ cbHud: 'yes' }).cbHud, false);
});

test('the Colour-blind HUD switch swaps the CSS tokens and persists', (t) => {
  const storage = new Map();
  const { c } = solo(t, { storage });
  assert.equal(c.run('document.body.classList.contains("cb-hud")'), false);
  c.run('toggleSetting("cbHud")');
  assert.equal(c.run('settings.cbHud'), true);
  assert.equal(c.run('document.body.classList.contains("cb-hud")'), true);
  assert.match(read('index.html'), /body\.cb-hud \{ --green: #[0-9A-Fa-f]{6}; --coral: #[0-9A-Fa-f]{6}; \}/);
  assert.ok([...storage.values()].some((v) => /"cbHud":true/.test(v)), 'saved');
});

test('Slower flare assist: solo only, flagged, and keeps seeded boards honest', (t) => {
  const { c } = solo(t);
  c.run('settings.assistFlare = false; startRun(); G.mode = "play";');
  assert.equal(c.run('G.assisted'), false);
  c.run('settings.assistFlare = true; startRun(); G.mode = "play";');
  assert.equal(c.run('G.assisted'), true, 'a solo run with the switch on is marked assisted');
  const speed = (assist) => c.run(`settings.assistFlare = ${assist}; startRun(); G.mode = "play"; G.flare.speed = bandParams(G.band, G.dist).flare; updateFlare(); G.flare.speed`);
  assert.ok(speed(true) < speed(false), 'assisted flare target is slower');
  const html = read('index.html');
  assert.match(html, /!SHOT && !G\.assisted\) \{/, 'daily record gated');
  assert.match(html, /G\.worldRng && !G\.assisted \? COURSE\.link/, 'no challenge link for assisted runs');
  assert.match(html, /G\.assisted = !!settings\.assistFlare && !SHOT && SHOT_SEED === null && !netLive\(\)/, 'never in rooms or goldens');
  // Presentation/input side only: the sim and world generator never read the assist.
  for (const f of ['src/arena.js', 'src/race.js', 'src/worldgen.js']) assert.ok(!/assistFlare|\bG\.assisted|cbHud/.test(read(f)), f + ' must not know about the UI assists');
});

test('Settings gets an Install row that follows the install prompt (UX-05)', (t) => {
  const { c } = solo(t);
  assert.equal(c.run('installable()'), false, 'nothing to install without beforeinstallprompt');
  c.run('deferredPrompt = { prompt() {} }');
  assert.equal(c.run('installable()'), true);
  c.run('promptInstall()');
  assert.equal(c.run('deferredPrompt'), null, 'prompt is single-use');
  assert.equal(c.run('flags.installDismissed'), true);
  assert.equal(c.run('installQuiet()'), true, 'quiet right after');
  c.run('flags.installDismissedAt = Date.now() - 31 * 24 * 3600 * 1000');
  assert.equal(c.run('installQuiet()'), false, 'the chip comes back after a month, not never');
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.shortcuts.some((s) => /Daily/.test(s.name) && s.url === './#daily'));
  assert.equal(manifest.lang, 'en');
  assert.match(read('index.html'), /location\.hash === '#daily' \? dailyCourse\(\)/, 'the shortcut url is handled');
});

test('Dialog overlays make the canvas and crew panel inert; race dialogs are aria-modal (UX-06)', (t) => {
  const { c } = solo(t);
  c.run('showOverlay("ovPause")');
  assert.equal(c.run('$("game").inert'), true);
  assert.equal(c.run('$("crewPanel").inert'), true);
  c.run('hideAllOverlays()');
  assert.equal(c.run('$("game").inert'), false);
  c.run('showOverlay("ovAttract")');
  assert.equal(c.run('$("game").inert'), false, 'the attract card keeps the scene live');
  const race = read('src/race-ui.js');
  for (const v of ['lobby', 'pausePanel', 'resultPanel']) assert.ok(race.includes(`${v}.setAttribute("aria-modal", "true")`), v);
});

test('Race minimap numbers its pilots under the colour-blind switch (A11Y-07)', () => {
  const race = read('src/race-ui.js');
  assert.match(race, /prefs\.cbHud\s*\? new Map\(R\.standings\(state\)/);
  assert.match(race, /rootEl\.dataset\.cb = String\(!!prefs\.cbHud\)/);
});

test('flash budget: no full-viewport bright fill outside the vignette (A11Y-06)', () => {
  const html = read('index.html');
  const sources = { 'index.html': html, 'src/arena-ui.js': read('src/arena-ui.js'), 'src/race-view.js': read('src/race-view.js'), 'src/race-ui.js': read('src/race-ui.js') };
  const bright = (col) => {
    const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(col.trim());
    if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; const n = parseInt(h, 16); return ((n >> 16) + ((n >> 8) & 255) + (n & 255)) / 3 > 170; }
    return /^(white|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i.test(col.trim());
  };
  const offenders = [];
  let seen = 0;
  for (const [file, src] of Object.entries(sources)) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/fillRect\(\s*0\s*,\s*0\s*,\s*(view\.w|W|width|cssW|canvas\.width)\b/.test(line)) return;
      seen++;
      const near = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
      const fills = [...near.matchAll(/fillStyle\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const last = fills[fills.length - 1];
      // A brief, decaying pulse at <= 0.4 alpha is the budget (the arena KO flash); anything stronger fails.
      const alphas = [...near.matchAll(/globalAlpha\s*=\s*(\.?\d*\.?\d+)/g)].map((m) => Number(m[1]));
      const cap = alphas.length ? alphas[alphas.length - 1] : 1;
      if (last && bright(last) && cap > 0.4) offenders.push(file + ':' + (i + 1) + ' ' + last);
    });
  }
  const ko = read('src/arena-ui.js');
  assert.match(ko, /if \(calm\(\)\) return;\s*\n\s*effects\.push\(\{ type: 'koflash'/, 'the KO flash is skipped under reduce motion');
  assert.ok(seen > 0, 'the scan still finds full-screen fills to check');
  assert.deepEqual(offenders, [], 'a full-screen bright fill is a photosensitivity risk; cap alpha and honour reduce motion');
  // Pulsing UI stays under the 3 Hz general flash threshold (1.6 s loop) and stops under reduce motion.
  assert.match(html, /\.btn\.pulse::after[^}]*animation: pulseHalo 1\.6s/);
  assert.match(html, /reduce-motion[^{]*\.btn\.pulse|\.btn\.pulse[^{]*reduce-motion/);
});

test('iOS haptic label layer stays documented (IN-04)', () => {
  const html = read('index.html');
  const hap = /\.hap-touch\s*\{[^}]*z-index:\s*(\d+)/.exec(html);
  assert.ok(hap, 'hap-touch layer exists');
  assert.equal(Number(hap[1]), 4, 'DOM HUD controls must sit above z-index 4');
  assert.match(html, /<label class="hap-touch" id="hapTouch" aria-hidden="true">/);
});

test('touch MOVE hint lifts clear of the active stick (UX-04)', () => {
  assert.match(read('index.html'), /if \(input\.stick\.active\) \{ hx = camX \+ input\.stick\.cx; hy = camY \+ clamp\(input\.stick\.cy - 70/);
});
