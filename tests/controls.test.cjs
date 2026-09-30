const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

test('touch controls draw for a new player and for one who has learned them, and recede only when idle', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run('startRun(); G.mode = "play"; input.usingTouch = true;');
  const alphas = [];
  const ctx = c.run('ctx');
  Object.defineProperty(ctx, 'globalAlpha', { configurable: true, get() { return 1; }, set(v) { alphas.push(Math.round(v * 100) / 100); } });
  const draw = () => { alphas.length = 0; c.run('drawTouchControls()'); return alphas.slice(); };

  // Every layer, in draw order: fire button, stick ring, stick knob, stick chevrons, jump ring, then reset.
  c.run('flags.taughtRun = flags.taughtJump = flags.taughtShoot = false');
  assert.deepEqual(draw(), [1, 0.3, 0.22, 0.38, 0.32, 1], 'a new player sees the controls at full strength');

  c.run('flags.taughtRun = flags.taughtJump = flags.taughtShoot = true');
  assert.deepEqual(draw(), [0.6, 0.18, 0.13, 0.23, 0.19, 1], 'a veteran with idle thumbs sees every layer at 60%');

  c.run('input.stick.active = true');
  assert.equal(draw()[0], 1, 'they wake up when a thumb lands on the stick');
  c.run('input.stick.active = false; input.shootBtn.pressed = true');
  assert.equal(draw()[0], 1, '…or on fire');
  c.run('input.shootBtn.pressed = false; input.jumpZone.active = true');
  assert.equal(draw()[0], 1, '…or jump');
});

test('a keyboard, mouse or controller takes over from the touch controls, and touch takes them back', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  const pad = { connected: true, mapping: 'standard', index: 0, axes: [0.9, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  c.context.navigator.getGamepads = () => [pad];
  c.run('startRun(); G.mode = "play"');
  const touching = () => c.run('input.usingTouch');
  const tap = (pointerType, id = 1) => c.dispatch('game', 'pointerdown', { pointerType, pointerId: id, clientX: 100, clientY: 500 });

  tap('touch');
  assert.equal(touching(), true, 'a finger on the glass shows the touch controls');
  tap('mouse', 2);
  assert.equal(touching(), false, 'a mouse click hides them (iPad with a trackpad)');
  tap('touch', 3);
  assert.equal(touching(), true, 'and a finger brings them back');
  c.run('onKey({ key: "a", preventDefault() {} }, true)');
  assert.equal(touching(), false, 'a key press hides them (iPad with a keyboard)');
  assert.equal(c.run('input.usingKeys'), true);
  tap('touch', 4);
  assert.equal(touching(), true, 'touch takes them back from the keyboard');
  assert.equal(c.run('input.usingKeys'), false);
  c.run('input.pad.index = 0; pollGamepad()');
  assert.equal(touching(), false, 'a controller stick hides them');
  assert.equal(c.run('input.usingGamepad'), true);
  tap('touch', 5);
  assert.equal(touching(), true, 'and a finger takes them back from the controller');
});
