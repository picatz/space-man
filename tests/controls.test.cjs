const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

test('touch guides show fully to a new player, recede for one who has learned move and jump, and wake when a thumb lands', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run('startRun(); G.mode = "play"; input.usingTouch = true;');
  const dim = () => c.run('touchDim()');
  c.run('flags.taughtRun = flags.taughtJump = false');
  assert.equal(dim(), 1, 'a new player sees the guides at full strength');
  c.run('flags.taughtRun = true; flags.taughtJump = false');
  assert.equal(dim(), 1, 'half-learned is still new');
  c.run('flags.taughtRun = flags.taughtJump = true');
  assert.equal(dim(), 0.6, 'a veteran with idle thumbs sees a quiet outline');
  c.run('input.stick.active = true');
  assert.equal(dim(), 1, 'they wake when a thumb lands on the stick');
  c.run('input.stick.active = false; input.shootBtn.pressed = true');
  assert.equal(dim(), 1, '...or on fire');
  c.run('input.shootBtn.pressed = false; input.jumpZone.active = true');
  assert.equal(dim(), 1, '...or jump');
  c.run('input.jumpZone.active = false');
  const ctx = c.run('ctx'), a = [];
  Object.defineProperty(ctx, 'globalAlpha', { configurable: true, get: () => 1, set: (v) => a.push(v) });
  c.run('drawTouchControls()');
  assert.ok(a.length > 5, 'and the controls actually draw');
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
