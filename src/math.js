/* Shared math helpers: the handful of tiny functions several presentation
   modules and the page script each used to define for themselves.
   Pure and dependency-free. The simulations (race.js, arena.js, enemies.js,
   worldgen.js) deliberately keep their own copies so each stays a standalone,
   self-contained file with no load-order coupling. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // '#rrggbb' -> [r, g, b] in 0..1. Callers validate; a malformed string yields NaNs.
  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // Seeded PRNG: the same seed always yields the same 0..1 sequence.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const api = { TAU, clamp, lerp, hexRgb, mulberry32 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
