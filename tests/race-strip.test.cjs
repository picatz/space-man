const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

function game(t) {
  const c = client(relay());
  t.after(() => c.close());
  c.run('raceView.at = -1');   // a fresh strip
  return c;
}
// Where on a strip of width 1 does each thing land?
const frac = (l, x) => (x - l.left) / l.span;

test('the strip is drawn in the pack\'s frame: keeping the same gap to the flare holds everything still', (t) => {
  const c = game(t);
  const lay = (xs, f, now) => c.run(`raceLayout(${JSON.stringify(xs)}, ${f}, ${now})`);
  let l = lay([5000], 4670, 0);
  const flare0 = frac(l, 4670), me0 = frac(l, 5000);
  for (let s = 1; s <= 10; s++) l = lay([5000 + s * 300], 4670 + s * 300, s * 0.1);   // both cover 3000px in a second
  assert.ok(Math.abs(frac(l, 4670 + 3000) - flare0) < 0.002, 'the flare has not moved along the strip');
  assert.ok(Math.abs(frac(l, 5000 + 3000) - me0) < 0.002, 'neither have you');
});

test('a small gap to the flare reads as small: you are not pinned to the far right', (t) => {
  const c = game(t);
  const l = c.run('raceLayout([5000], 4670, 0)');           // 33 m ahead of the flare
  assert.ok(frac(l, 5000) < 0.45, 'you sit left of the middle: ' + frac(l, 5000));
  assert.ok(frac(l, 4670) < 0.12 && frac(l, 4670) > 0.02, 'the flare hugs the left edge: ' + frac(l, 4670));
  assert.ok(l.span >= 1200, 'never narrower than 120 m');
});

test('a big gap widens the strip to fit everybody, with room to spare', (t) => {
  const c = game(t);
  const l = c.run('raceLayout([20000, 9000, 15000], 6000, 0)');
  for (const x of [20000, 9000, 15000, 6000]) { const f = frac(l, x); assert.ok(f > 0 && f < 1, x + ' is on the strip: ' + f); }
  assert.ok(frac(l, 20000) < 0.85, 'the leader is not jammed against the end');
});

test('the scale glides when someone joins far ahead or respawns, and never jumps', (t) => {
  const c = game(t);
  c.run('raceLayout([5000], 4670, 0)');
  let prev = c.run('raceView.span'), worstStep = 0;
  for (let i = 1; i <= 30; i++) {                             // a runner appears 400 m ahead
    const l = c.run(`raceLayout([5000, 9000], 4670, ${i / 60})`);
    worstStep = Math.max(worstStep, Math.abs(l.span - prev)); prev = l.span;
  }
  assert.ok(worstStep < 400, 'no frame changes the span by more than a third of the way: ' + worstStep);
  let settled; for (let i = 31; i <= 400; i++) settled = c.run(`raceLayout([5000, 9000], 4670, ${i / 60})`);
  assert.ok(Math.abs(settled.span - (9000 - 4670) * 1.3) < 5, 'and it lands on the fitted width');
});

test('the rearmost runner dying or leaving eases the frame instead of snapping it', (t) => {
  const c = game(t);
  const before = c.run('raceLayout([3000, 9000], 6000, 0)');
  const flareBefore = frac(before, 6000);
  let l = c.run('raceLayout([9000], 6000, 1 / 60)');            // the runner at 3000 (behind the flare) is gone
  let moved = Math.abs(frac(l, 6000) - flareBefore);
  assert.ok(moved < 0.05, 'the first frame barely moves: ' + moved);
  for (let i = 2; i <= 240; i++) l = c.run(`raceLayout([9000], 6000, ${i / 60})`);
  assert.ok(Math.abs(frac(l, 6000) - 0.06 / 1.0 * (1200 / l.span)) < 0.05 || frac(l, 6000) < 0.15, 'and settles with the flare near the left edge: ' + frac(l, 6000));
});

test('a hitch (tab in the background) cannot fling the layout, and a fresh strip starts already fitted', (t) => {
  const c = game(t);
  const first = c.run('raceLayout([5000], 4670, 100)');
  assert.ok(Math.abs(first.left - (4670 - 1200 * 0.06)) < 1e-6, 'no easing from a stale layout on the first frame');
  const after = c.run('raceLayout([5000], 4670, 900)');     // eight minutes later
  assert.ok(Math.abs(after.left - first.left) < 1e-3, 'same inputs, same layout');
});

test('tick spacing keeps the strip readable at every scale', (t) => {
  const c = game(t);
  for (const [span, expect] of [[1200, 200], [2000, 200], [5000, 500], [30000, 5000], [100000, 10000]]) {
    const step = c.run(`raceTickStep(${span})`);
    assert.equal(step, expect, 'span ' + span);
    assert.ok(span / step <= 10);
  }
});

test('a new run or leaving the room starts the strip fresh, so it never eases in from the last run\'s coordinates', (t) => {
  const c = game(t);
  c.run('raceLayout([90000], 88000, 1); raceLayout([90000], 88000, 2)');
  assert.notEqual(c.run('raceView.at'), -1);
  c.run('resetRun(7, true)');
  assert.equal(c.run('raceView.at'), -1, 'a restart resets it');
  const l = c.run('raceLayout([5000], 4670, 3)');
  assert.ok(Math.abs(l.left - (4670 - 1200 * 0.06)) < 1e-6, 'and the first frame of the new run is already fitted, not 88000 px away');
  c.run('leaveRoom()');
  assert.equal(c.run('raceView.at'), -1, 'leaving the room resets it too');
});

test('nameplates are kept clear of the strip through the live transform, including zoom, shake and offset', (t) => {
  const c = game(t);
  const ctx = c.run('ctx');
  const matrix = (a, d, e, f) => ({ a, b: 0, c: 0, d, e, f });
  c.run('view.h = 400; canvas.height = 800');                       // 2 device px per view px
  const stripBottom = 12 + 26 + 6;                                  // no notch in the harness
  const at = (m) => { ctx.getTransform = () => m; return c.run('raceFloorWorldY(300)'); };
  const screenY = (m, wy) => m.d * wy + m.f;
  for (const m of [matrix(2, 2, 0, 0), matrix(2.5, 2.5, -40, -300), matrix(2, 2, 0, 24), matrix(1.6, 1.6, 0, -90)]) {
    const wy = at(m);
    assert.ok(Math.abs(screenY(m, wy) - stripBottom * 2) < 1e-6, 'that world y lands exactly under the strip: ' + JSON.stringify(m));
  }
  ctx.getTransform = () => ({ a: 2, b: 0.1, c: -0.1, d: 2, e: 0, f: 0 });   // a little shake rotation
  const wy = c.run('raceFloorWorldY(300)');
  assert.ok(Math.abs((0.1 * 300 + 2 * wy) - stripBottom * 2) < 1e-6, 'rotation is accounted for at that x');
  delete ctx.getTransform;
  c.run('G.camY = 100');
  assert.equal(c.run('raceFloorWorldY(300)'), 100 + stripBottom, 'without a matrix it falls back to the camera offset');
});
