const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

function solo(t, opts) {
  const hub = relay(), c = client(hub, opts);
  t.after(() => c.close());
  return { hub, c };
}
const key = (k) => ({ key: k, preventDefault() {} });

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
  assert.deepEqual({ ...c.run('settings.keys') }, { left: 'a', right: 'd', jump: 'w', fire: 'f' });
  c.run('toggleSetting("reduceMotion"); beginRebind("jump", "Jump"); rebindKey("e"); beginRebind("left", "Move left"); rebindKey("d");');
  assert.deepEqual({ ...c.run('settings.keys') }, { left: 'd', right: 'a', jump: 'e', fire: 'f' }, 'a taken key swaps, never duplicates');

  const again = client(hub, { storage });
  t.after(() => again.close());
  assert.equal(again.run('settings.reduceMotion'), true);
  assert.deepEqual({ ...again.run('settings.keys') }, { left: 'd', right: 'a', jump: 'e', fire: 'f' });
  again.run('onKey({ key: "E", preventDefault() {} }, true)');
  assert.equal(again.run('input.jumpPressed'), true, 'rebound jump key drives the run');
  again.run('onKey({ key: "d", preventDefault() {} }, true)');
  assert.equal(again.run('input.left'), true);
  assert.equal(again.run('rebinding = "fire"; rebindKey("escape")'), false, 'reserved keys are refused');
  again.run('resetKeys()');
  assert.deepEqual({ ...again.run('settings.keys') }, { left: 'a', right: 'd', jump: 'w', fire: 'f' });

  for (const bad of [{ reduceMotion: 'yes', keys: { left: 'escape', right: 5 } }, { keys: { left: 'a', right: 'a' } }, { keys: 'wasd' }]) {
    const s = new Map([['sm2.settings', JSON.stringify(bad)]]);
    const g = client(hub, { storage: s });
    t.after(() => g.close());
    assert.equal(g.run('settings.reduceMotion'), false);
    assert.deepEqual({ ...g.run('settings.keys') }, { left: 'a', right: 'd', jump: 'w', fire: 'f' });
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
  assert.deepEqual({ ...g.run('settings.keys') }, { left: 'a', right: 'd', jump: 'w', fire: 'f' });
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
