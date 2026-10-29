/* Shared effects kit: one look for the big moments in every mode.
   Stateless canvas painters. A mode keeps its own effect list and lifetimes
   and calls draw(ctx, kind, x, y, k, opts) each frame with k = 0..1 progress.
   The vocabulary is docs/art-direction.md, "Light, depth and FX": hits flash
   white and burst in the attacker's color, pickups sparkle gold, boosts streak
   cyan, knockouts ping a star, landings puff dust. Render-only rules hold:
   no shadowBlur, filters or per-frame gradients, and no Math.random (seed
   varies the spark angles so peers and screenshots agree). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  // Default lifetimes in 60 Hz ticks, so every mode holds a moment equally long.
  const LIFE = Object.freeze({ hit: 18, ko: 44, pickup: 26, boost: 14, land: 16, spawn: 22, dodge: 16 });
  // Screen-shake trauma and haptic tier per moment (three tiers, per the guide).
  const SHAKE = Object.freeze({ hit: 0.22, ko: 0.5, pickup: 0, boost: 0.06, land: 0.08, spawn: 0, dodge: 0 });
  const HAPTIC = Object.freeze({ hit: 'medium', ko: 'heavy', pickup: 'light', boost: 'light', land: null, spawn: null, dodge: null });
  const GOLD = '#FFC93C', WHITE = '#FFFFFF', CYAN = '#9FF1FF', DUST = 'rgba(207,227,255,0.8)';

  function spark(c, x, y, angle, from, to, width) {
    c.lineWidth = width; c.beginPath();
    c.moveTo(x + Math.cos(angle) * from, y + Math.sin(angle) * from);
    c.lineTo(x + Math.cos(angle) * to, y + Math.sin(angle) * to); c.stroke();
  }
  function star(c, x, y, r, inner) {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 4, d = i % 2 ? r * inner : r;
      if (i) c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    c.closePath();
  }

  const PAINT = {
    // A white core flash, a ring burst in the attacker's color and six sparks.
    hit(c, x, y, k, o) {
      const s = o.scale, color = o.color || WHITE, e = easeOut(k);
      if (k < 0.3) { c.globalAlpha = (1 - k / 0.3) * 0.9; c.fillStyle = WHITE; c.beginPath(); c.arc(x, y, (6 + 6 * k / 0.3) * s, 0, TAU); c.fill(); }
      c.globalAlpha = (1 - k) * 0.9; c.strokeStyle = color; c.lineWidth = (3 - 2 * k) * s;
      c.beginPath(); c.arc(x, y, (8 + 22 * e) * s, 0, TAU); c.stroke();
      if (!o.saver) for (let i = 0; i < 6; i++) spark(c, x, y, i * TAU / 6 + o.seed, (10 + 18 * e) * s, (16 + 26 * e) * s, 2 * s * (1 - k));
    },
    // A star ping where a pilot left the arena, with a wide ring.
    ko(c, x, y, k, o) {
      const s = o.scale, color = o.color || GOLD, e = easeOut(k), pop = k < 0.25 ? 0.6 + 1.6 * k / 0.25 : 1.0 + 0.2 * (1 - k);
      c.globalAlpha = (1 - k) * 0.7; c.strokeStyle = color; c.lineWidth = 3 * s * (1 - k) + 1;
      c.beginPath(); c.arc(x, y, (18 + 56 * e) * s, 0, TAU); c.stroke();
      c.globalAlpha = 1 - k * k; star(c, x, y, 13 * s * pop, 0.38);
      c.fillStyle = color; c.fill(); c.strokeStyle = WHITE; c.lineWidth = 1.5 * s; c.stroke();
    },
    // Gold four-point sparkles drifting up and out.
    pickup(c, x, y, k, o) {
      const s = o.scale, color = o.color || GOLD, e = easeOut(k), n = o.saver ? 4 : 8;
      c.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + o.seed, r = (6 + 20 * e) * s;
        c.globalAlpha = (1 - k) * (i % 2 ? 0.7 : 1);
        star(c, x + Math.cos(a) * r, y + Math.sin(a) * r - 10 * e * s, (i % 2 ? 2.4 : 3.6) * s * (1 - 0.5 * k), 0.35); c.fill();
      }
      c.globalAlpha = (1 - k) * 0.5; c.fillStyle = WHITE; c.beginPath(); c.arc(x, y, 4 * s * (1 - k), 0, TAU); c.fill();
    },
    // Cyan streaks trailing away from the travel direction (o.dirX, o.dirY).
    boost(c, x, y, k, o) {
      const s = o.scale, len = Math.hypot(o.dirX, o.dirY) || 1, dx = -o.dirX / len, dy = -o.dirY / len, px = -dy, py = dx;
      c.strokeStyle = o.color || CYAN; c.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        c.globalAlpha = (1 - k) * (i ? 0.5 : 0.85); c.lineWidth = (i ? 1.5 : 2.5) * s;
        const ox = x + px * i * 6 * s, oy = y + py * i * 6 * s, from = (6 + 10 * k) * s, to = (20 + 22 * k) * s * (i ? 0.7 : 1);
        c.beginPath(); c.moveTo(ox + dx * from, oy + dy * from); c.lineTo(ox + dx * to, oy + dy * to); c.stroke();
      }
    },
    // A low dust puff spreading both ways from the feet.
    land(c, x, y, k, o) {
      const s = o.scale, e = easeOut(k);
      c.fillStyle = o.color || DUST;
      for (let i = 0; i < 5; i++) {
        const side = i - 2; c.globalAlpha = (1 - k) * (0.65 - Math.abs(side) * 0.1);
        c.beginPath(); c.arc(x + side * (5 + 9 * e) * s, y - (1 + 3 * e) * s * (1 - Math.abs(side) * 0.3), (1.6 + 1.8 * e) * s, 0, TAU); c.fill();
      }
    },
    // A ring closing in where something arrives.
    spawn(c, x, y, k, o) {
      const s = o.scale, color = o.color || CYAN;
      const alpha = 0.85 * (k < 0.8 ? 1 : (1 - k) / 0.2);
      c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = 2 * s;
      c.beginPath(); c.arc(x, y, (30 - 22 * easeOut(k)) * s, 0, TAU); c.stroke();
      c.globalAlpha = alpha * 0.4; c.beginPath(); c.arc(x, y, (14 - 10 * easeOut(k)) * s, 0, TAU); c.stroke();
    },
    // A thin white ring: a near miss.
    dodge(c, x, y, k, o) {
      c.globalAlpha = (1 - k) * 0.8; c.strokeStyle = o.color || WHITE; c.lineWidth = 1.5 * o.scale;
      c.beginPath(); c.arc(x, y, (12 + 26 * easeOut(k)) * o.scale, 0, TAU); c.stroke();
    },
  };

  // Paint one moment at progress k (0..1). opts: color, scale (1 = arena
  // units), seed (spark angle offset), calm (reduced motion: a still marker,
  // the information without the motion), saver (fewer particles), dirX/dirY
  // (boost travel direction). Returns false for an unknown kind or finished k.
  function draw(c, kind, x, y, k, opts = {}) {
    const paint = PAINT[kind];
    if (!paint || !(k >= 0 && k < 1) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const o = { color: opts.color, scale: clamp(Number(opts.scale) || 1, 0.25, 8), seed: Number(opts.seed) || 0,
      saver: !!opts.saver, dirX: Number(opts.dirX) || 1, dirY: Number(opts.dirY) || 0 };
    c.save();
    if (opts.calm) {
      // Reduced motion keeps the beat as a color change at a fixed size.
      c.globalAlpha = 0.75 * (1 - k); c.fillStyle = o.color || (kind === 'pickup' ? GOLD : kind === 'boost' ? CYAN : WHITE);
      if (kind === 'ko' || kind === 'pickup') { star(c, x, y, 7 * o.scale, 0.4); c.fill(); }
      else { c.beginPath(); c.arc(x, y, 5 * o.scale, 0, TAU); c.fill(); }
    } else paint(c, x, y, clamp(k, 0, 1), o);
    c.restore();
    return true;
  }

  const api = Object.freeze({ KINDS: Object.freeze(Object.keys(PAINT)), LIFE, SHAKE, HAPTIC, draw });
  root.SpaceManFX = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
