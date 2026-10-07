const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/math.js');

test('clamp and lerp', () => {
  assert.equal(M.clamp(5, 0, 3), 3);
  assert.equal(M.clamp(-1, 0, 3), 0);
  assert.equal(M.clamp(2, 0, 3), 2);
  assert.equal(M.lerp(10, 20, 0.25), 12.5);
  assert.equal(M.TAU, Math.PI * 2);
});

test('hexRgb parses #rrggbb to 0..1 triples', () => {
  assert.deepEqual(M.hexRgb('#ff0080'), [1, 0, 128 / 255]);
  assert.ok(M.hexRgb('#zzzzzz').every(Number.isNaN));
});

test('mulberry32 is seeded, repeatable and in [0, 1)', () => {
  const a = M.mulberry32(9999), b = M.mulberry32(9999), c = M.mulberry32(1);
  const xs = Array.from({ length: 50 }, a), ys = Array.from({ length: 50 }, b);
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, Array.from({ length: 50 }, c));
  assert.ok(xs.every((v) => v >= 0 && v < 1));
  assert.equal(M.mulberry32(1)(), 0.6270739405881613);   // pinned: worldgen/replay seeds depend on this exact stream
});
