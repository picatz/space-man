const test = require('node:test'), assert = require('node:assert/strict');
const FX = require('../src/fx.js');

// A recording 2D context: every call and property write, in order.
function recorder() {
  const log = [], ctx = new Proxy({}, {
    get: (_, key) => (...args) => { log.push([key, ...args]); },
    set: (_, key, value) => { log.push(['=' + key, value]); return true; },
  });
  return { ctx, log };
}

test('every moment paints at every stage, saves and restores, and never uses blur or filters', () => {
  for (const kind of FX.KINDS) for (const k of [0, 0.1, 0.5, 0.99]) for (const opts of [{}, { calm: true }, { saver: true, color: '#38E1FF', scale: 2 }]) {
    const { ctx, log } = recorder();
    assert.equal(FX.draw(ctx, kind, 100, 80, k, opts), true, kind + ' ' + k);
    assert.deepEqual(log[0], ['save']); assert.deepEqual(log.at(-1), ['restore']);
    assert.ok(!log.some(([key]) => /shadowBlur|filter|createRadialGradient|createLinearGradient/.test(key)), kind);
    assert.ok(log.some(([key]) => key === 'fill' || key === 'stroke'), kind + ' draws something');
    for (const [key, value] of log) if (key === '=globalAlpha') assert.ok(value >= 0 && value <= 1, kind + ' alpha ' + value);
  }
});

test('finished, unknown or non-finite moments draw nothing', () => {
  for (const [kind, x, k] of [['hit', 1, 1], ['hit', 1, -0.1], ['hit', NaN, 0.5], ['nope', 1, 0.5], ['ko', 1, NaN]]) {
    const { ctx, log } = recorder();
    assert.equal(FX.draw(ctx, kind, x, 1, k), false); assert.deepEqual(log, []);
  }
});

test('painting is deterministic, the seed turns the sparks, and calm keeps only a still marker', () => {
  const run = (opts) => { const { ctx, log } = recorder(); FX.draw(ctx, 'hit', 10, 10, 0.4, opts); return JSON.stringify(log); };
  assert.equal(run({ seed: 3 }), run({ seed: 3 }));
  assert.notEqual(run({ seed: 3 }), run({ seed: 4 }));
  const busy = JSON.parse(run({})).length, calm = JSON.parse(run({ calm: true })).length, saver = JSON.parse(run({ saver: true })).length;
  assert.ok(calm < saver && saver < busy, `calm ${calm} < saver ${saver} < full ${busy}`);
});

test('every moment has a lifetime, shake and haptic tier, with knockouts the strongest', () => {
  for (const kind of FX.KINDS) {
    assert.ok(Number.isInteger(FX.LIFE[kind]) && FX.LIFE[kind] > 0, kind);
    assert.ok(FX.SHAKE[kind] >= 0 && FX.SHAKE[kind] <= FX.SHAKE.ko, kind);
    assert.ok([null, 'light', 'medium', 'heavy'].includes(FX.HAPTIC[kind]), kind);
  }
  assert.equal(FX.HAPTIC.ko, 'heavy'); assert.ok(Object.isFrozen(FX.LIFE));
});
