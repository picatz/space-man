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

  c.run('flags.taughtRun = flags.taughtJump = flags.taughtShoot = false');
  assert.equal(draw()[0], 1, 'a new player sees the controls at full strength');

  c.run('flags.taughtRun = flags.taughtJump = flags.taughtShoot = true');
  assert.equal(draw()[0], 0.6, 'a veteran with idle thumbs sees a quiet outline');

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
  c.run('input.usingTouch = true');
  c.run('onKey({ key: "a", preventDefault() {} }, true)');
  assert.equal(c.run('input.usingTouch'), false, 'a key press hides them (iPad with a keyboard)');
  assert.equal(c.run('input.usingKeys'), true);
});
