/* Shared art kit — one palette, one set of cheap draw helpers.
   Anything that paints the world (the core renderer, new enemies, power-ups)
   should take its colors from SpaceManArt.C and its glows/shadows/eyes from
   here, so a new thing looks like it belongs the moment it lands.
   Rules the helpers keep: no shadowBlur/filter, no per-frame gradients (glows are
   cached sprites), no Math.random (the renderer must never perturb the run). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // The palette — mirrors the CSS custom properties on :root.
  const C = Object.freeze({
    void: '#060818', nebula: '#131A3A', horizon: '#2A2560',
    cyan: '#38E1FF', cyanLt: '#9FF1FF', suit: '#F4F7FF', orange: '#FFB454',
    green: '#4EF07A', greenDk: '#1F9E4E', coral: '#FF4F66', gold: '#FFC93C', goldLt: '#FFE59A',
    ui: '#CFE3FF', ink: '#0A1428', panel: 'rgba(10,14,32,0.86)', panelSolid: '#0A0E20',
    flare: '#FF8A6B',
  });
  // Semantic roles for gameplay reads — keep hazards warm, friends cool, rewards gold.
  const ROLE = Object.freeze({ hazard: C.coral, friend: C.cyan, reward: C.gold, enemy: C.green, text: C.ui, power: '#B87BFF' });

  // Biome colors for a sector hue (degrees). Pure: same hue → same strings.
  // sky* are the gradient stops, ridge* the two skyline silhouettes (far/near),
  // rim the light catching the ridge tops, mote the ambient dust tint.
  function biome(hue) {
    const h = ((hue % 360) + 360) % 360;
    return {
      hue: h,
      ridgeFar: `hsl(${h} 34% 11%)`, ridgeNear: `hsl(${h} 40% 7%)`,
      rimFar: `hsla(${(h + 330) % 360}, 80%, 70%, 0.22)`, rimNear: `hsla(${(h + 340) % 360}, 90%, 72%, 0.35)`,
      mote: `hsla(${(h + 180) % 360}, 70%, 85%, 1)`, accent: `hsl(${(h + 150) % 360} 85% 66%)`,
      glow: `hsla(${h}, 85%, 62%, 0.35)`,
    };
  }

  // Seamless 1-D ridge profile: integer-frequency sines over the tile width so
  // column 0 and column W match. Returns heights 0..1 into out (length W+1).
  function ridgeProfile(W, seed, rough, out) {
    const f = [1, 2, 3, 5, 8, 13], a = [0.5, 0.25, 0.14, 0.07, 0.035 * rough, 0.02 * rough];
    const ph = f.map((_, i) => (Math.sin((seed + 1) * (i + 1) * 91.7) * 0.5 + 0.5) * TAU);
    for (let x = 0; x <= W; x++) {
      let v = 0;
      // low octaves roll, high octaves are 'ridged' (1-|sin|) so crests come to peaks
      for (let i = 0; i < f.length; i++) {
        const s = Math.sin((x / W) * TAU * f[i] + ph[i]);
        v += (i < 2 ? s : (1 - Math.abs(s)) * 2 - 1) * a[i];
      }
      out[x] = clamp(0.5 + v, 0, 1);
    }
    return out;
  }

  const cache = new Map();
  function makeCanvas(w, h) {
    const c = root.document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  // Cached radial glow: the only sanctioned way to make something glow.
  function glow(radius, color, inner) {
    const key = 'g' + radius + color + (inner || 0.35);
    let c = cache.get(key);
    if (!c) {
      c = makeCanvas(radius * 2, radius * 2);
      const g = c.getContext('2d'), grd = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
      grd.addColorStop(0, color); grd.addColorStop(inner || 0.35, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(radius, radius, radius, 0, TAU); g.fill();
      cache.set(key, c);
    }
    return c;
  }
  // Soft elliptical contact shadow under anything standing on a slab.
  // strength 0..1 (fade it with height above the surface).
  function contactShadow(ctx, x, y, w, strength) {
    if (strength <= 0.02) return;
    const s = glow(32, 'rgba(0,0,0,0.55)', 0.3);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * clamp(strength, 0, 1);
    ctx.drawImage(s, x - w / 2, y - w * 0.14, w, w * 0.28);
    ctx.globalAlpha = a;
  }

  /* Cartoon eyes in the house style (the aliens' look), for any new character.
     lookX/lookY -1..1, lid 0 open..1 closed, mood 0 neutral 1 happy 2 wide 3 sleepy. */
  function eyes(ctx, x, y, spacing, rx, ry, lookX, lookY, lid, mood, white, pupil) {
    for (let s = -1; s <= 1; s += 2) {
      const ex = x + s * spacing;
      if (mood === 1) {   // happy ^^
        ctx.strokeStyle = pupil || C.ink; ctx.lineWidth = Math.max(1, rx * 0.45); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(ex, y + ry * 0.35, rx * 0.85, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        continue;
      }
      const open = mood === 3 ? 0.45 : mood === 2 ? 1.15 : 1;
      const h = Math.max(0.6, ry * open * (1 - lid));
      ctx.fillStyle = white || '#FFFFFF';
      ctx.beginPath(); ctx.ellipse(ex, y, rx, h, 0, 0, TAU); ctx.fill();
      if (h > 1.2) {
        const pr = Math.min(rx, h) * (mood === 2 ? 0.38 : 0.52);
        ctx.fillStyle = pupil || C.ink;
        ctx.beginPath(); ctx.arc(ex + lookX * rx * 0.35, y + lookY * h * 0.3, pr, 0, TAU); ctx.fill();
      }
    }
  }

  // Easing set shared by render code (and mirrored by the CSS --ease tokens).
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  };

  root.SpaceManArt = { C, ROLE, biome, ridgeProfile, glow, contactShadow, eyes, ease, makeCanvas };
})(typeof window !== 'undefined' ? window : globalThis);
