/* World gen 2: designed segments chosen by a seeded pacing director.

   The old generator scattered one platform at a time with uniform random gaps
   and enemies, so every stretch felt like every other. This one builds the
   course out of SET PIECES (hops, staircases, stepping stones, split paths, a
   diver over a gap, a brute arena, a bomber run ...) and a director that
   sequences them the way a level designer would:

     teach → test → twist → rest, in cycles, each cycle about one FOCUS element.

   A new element (an enemy type, narrow ledges, crumbling slabs ...) unlocks at
   a set distance and the next cycle introduces it with a dedicated, forgiving
   INTRO segment, then tests it, then twists it (combined with harder terrain or
   a second element), then gives the player a breather with stars. Intensity
   rises with distance in waves; sector crossings always land on a breather.
   The first ~550 m are a fixed teaching script, so every run opens the same way.

   Fairness is structural, not hoped for: every gap is sized from the player's
   REAL jump arc (simulated from CFG, the same integration as updatePlayer) and
   keeps MARGIN px below the true full-speed reach at its climb.
   tests/worldgen.test.cjs proves it with the real updatePlayer.

   DETERMINISM: everything is drawn from the rng the sim hands in (the isolated
   world stream in replayable courses and rooms). No wall clock, no Math.random,
   no viewport, no gameplay state is read. Only the player's x decides HOW FAR
   ahead to build, never WHAT gets built. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const MARGIN = 36;            // px every generated gap keeps below the true reach at its climb
  const LOOKAHEAD = 1400;       // same fixed, player-relative lookahead as gen 1
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---- Jump physics ------------------------------------------------------
     Mirrors updatePlayer exactly: jump frame sets vy, the variable-jump cut,
     gravity (rise while held) × the course's gravity multiplier, then move. The
     player's centre starts at the takeoff lip at full run speed; the result is
     the centre's x on the frame the feet cross a slab `climb` px higher while
     falling — i.e. the widest gap landable with NO ledge forgiveness. */
  function simJump(cfg, gm, climb, hold) {
    let vy = cfg.jumpVel, jumping = true, x = 0, feet = 0;
    const Y = -climb;
    for (let f = 0; f < 400; f++) {
      const held = f < hold;
      if (jumping && vy < 0 && !held) { vy *= cfg.varJumpCut; jumping = false; }
      vy += ((vy < 0 && held && jumping) ? cfg.gravRise : cfg.gravFall) * gm;
      if (vy > cfg.maxFall) vy = cfg.maxFall;
      if (vy >= 0) jumping = false;
      x += cfg.maxRun;
      const prev = feet; feet += vy;
      if (vy >= 0 && prev <= Y + 2 && feet >= Y) return x;
      if (feet > 800) return -1;
    }
    return -1;
  }
  const CLIMB_LO = -320, CLIMB_HI = 240;
  const tables = new Map();
  function physics(cfg, gm) {
    const key = gm + ':' + cfg.jumpVel + ':' + cfg.maxRun;
    let t = tables.get(key);
    if (!t) {
      const reach = new Float64Array(CLIMB_HI - CLIMB_LO + 1);
      for (let c = CLIMB_LO; c <= CLIMB_HI; c++) reach[c - CLIMB_LO] = simJump(cfg, gm, c, Infinity);
      // Highest climb that still leaves a comfortable gap (≥ 90 px after the margin).
      let maxClimb = 0;
      for (let c = 0; c <= CLIMB_HI; c++) if (reach[c - CLIMB_LO] - MARGIN >= 90) maxClimb = c;
      t = { reach, maxClimb };
      tables.set(key, t);
    }
    return t;
  }
  function reachAt(P, climb) {
    const i = Math.round(climb) - CLIMB_LO;
    return i < 0 ? P.reach[0] : i >= P.reach.length ? -1 : P.reach[i];
  }

  /* ---- Elements & when they arrive (m) ---------------------------------- */
  const ELEMENTS = ['hop', 'patrol', 'climb', 'shooter', 'narrow', 'diver', 'shield', 'split', 'bomber', 'brute', 'turret', 'debris'];
  const UNLOCK = { hop: 0, patrol: 0, climb: 0, shooter: 300, narrow: 650, diver: 800, shield: 1000, split: 1200, bomber: 1400, brute: 1650, turret: 1900, debris: 2750 };
  const INTRO = { hop: 'hops', patrol: 'introPatrol', climb: 'stairsUp', shooter: 'introShooter', narrow: 'introNarrow', diver: 'introDiver',
    split: 'splitPath', shield: 'introShield', bomber: 'introBomber', brute: 'introBrute', turret: 'introTurret', debris: 'introDebris' };
  const ENEMY_ELEMENTS = ['patrol', 'shooter', 'diver', 'shield', 'bomber', 'brute', 'turret'];

  /* ---- Placement primitives (W = per-run context) ----------------------- */
  function rng(W) { return W.api.rng(); }
  function rnd(W, a, b) { return a + (b - a) * W.api.rng(); }
  function distAt(W, x) { return (x - W.G.startX) / 10; }
  function heat(d) { return clamp((d - 200) / 2600, 0, 1); }
  function unlocked(W, el, d) { return (W.unlock[el] || 0) <= d; }
  function mercyScale(W, d) {
    const G = W.G;
    return G.mercyLvl > 0 && d < G.genStartM + 150 + 50 * G.mercyLvl ? 1 - 0.05 * G.mercyLvl : 1;
  }
  // Keep G.platforms sorted by x (split paths build two tiers side by side).
  function insertPlat(W, p) {
    const a = W.G.platforms; let i = a.length;
    while (i > 0 && a[i - 1].x > p.x) i--;
    a.splice(i, 0, p);
    W.seg.push(p);
    if (p.x + p.w > W.G.genX) W.G.genX = p.x + p.w;
  }
  // Next main-path slab: `frac` of the true reach at its climb, capped MARGIN below it.
  function plat(W, frac, climb, w, from) {
    const last = from || W.S.last;
    climb = Math.min(climb, W.P.maxClimb);
    const y = clamp(last.y - climb, W.yMin, W.yMax);
    climb = last.y - y;
    const R = reachAt(W.P, climb);
    const x0 = last.x + last.w, d = distAt(W, x0);
    const gap = clamp(frac * R, 44, R - MARGIN) * mercyScale(W, d);
    const p = W.api.newPlatform(x0 + gap, y, Math.round(w));
    insertPlat(W, p);
    if (!from) W.S.last = p;
    return p;
  }
  const gapFrac = (W, lvl) => lerp(0.42, 0.8, lvl) + (rng(W) - 0.5) * 0.08;
  const wMid = (W, lvl) => rnd(W, lerp(260, 205, lvl), lerp(330, 270, lvl));
  const wWide = (W) => rnd(W, 330, 420);
  const wNarrow = (W) => rnd(W, 94, 128);

  // Alien identity on the wire is round(spawn x · 8): keep it unique among the
  // generator's own recent spawns (never G.enemies — gameplay culls that).
  function uniqX(W, x) {
    const ids = W.S.ids;
    let id = Math.round(x * 8);
    while (ids.indexOf(id) >= 0) { x += 1; id = Math.round(x * 8); }
    ids.push(id); if (ids.length > 48) ids.shift();
    return x;
  }
  function count(W, base) {           // theme-scaled enemy count (always one rng draw)
    const r = rng(W);
    return Math.max(0, Math.floor(base * W.mod.enemy + r * (W.mod.enemy !== 1 ? 1 : 0)));
  }
  function skipFoe(W, d) {            // mercy thins the opening; one draw either way
    const r = rng(W);
    return mercyScale(W, d) < 1 && r < 0.5;
  }
  function bandAt(W, x) { const d = distAt(W, x); return W.api.bandParams(W.api.bandFor(d), d); }
  function push(W, e) { W.G.enemies.push(e); W.S.foes++; return e; }
  function patrol(W, pl, t, dir, speed) {
    if (pl.w < 150 || skipFoe(W, distAt(W, pl.x))) return null;
    const x = uniqX(W, pl.x + 14 + t * (pl.w - 28));
    return push(W, W.api.patrolAt(pl, x, dir, speed || rnd(W, 1.0, 1.5) + 0.4 * heat(distAt(W, pl.x))));
  }
  function shooter(W, pl, high, force) {
    const cx = pl.x + pl.w / 2;
    if (!force && Math.abs(W.S.lastRangedX - cx) < 420) return null;
    if (skipFoe(W, distAt(W, pl.x))) return null;
    const B = bandAt(W, cx);
    let sx = high ? pl.x + (rng(W) < 0.5 ? pl.w * 0.15 : pl.w * 0.85) : pl.x + rnd(W, pl.w * 0.3, pl.w * 0.75);
    sx = uniqX(W, sx);
    const sy = pl.y - (high ? 90 : 34);
    W.S.lastRangedX = sx;
    return push(W, { type: 'shoot', x: sx, y: sy, px: sx, py: sy, baseY: sy, w: 26, h: 24, dir: 1,
      fireT: rnd(W, 0.6, B.shootIvl), telegraph: 0, dead: false, squash: 0, bob: rng(W) * TAU, lookX: 0, lookY: 0 });
  }
  function foe(type, x, y, w, h, o) {
    const e = { type, v2: true, x, y, px: x, py: y, x0: x, w, h, dir: -1, dead: false, squash: 0, lookX: 0, lookY: 0,
      age: 0, ph: 0, ev: -1, telegraph: 0, state: -1, hurt: 0, hp: 1, golden: false };
    for (const k in o) e[k] = o[k];
    return e;
  }
  // Diver hovering at (hx, hy) that swoops `span` px sideways, dipping `depth`.
  function diver(W, hx, hy, span, depth, phase) {
    if (skipFoe(W, distAt(W, hx))) return null;
    const h = heat(distAt(W, hx)), per = Math.round(lerp(230, 170, h));
    hx = uniqX(W, hx);
    const ph = phase !== undefined ? phase : Math.floor(rng(W) * per * 2);
    return push(W, foe('diver', hx, hy, 26, 20, { hx, hy, span, depth, per, ph, ax: hx, bx: hx + span, s: 0, flap: 0 }));
  }
  function shield(W, pl, t, dir) {
    if (pl.w < 170 || skipFoe(W, distAt(W, pl.x))) return null;
    const x = uniqX(W, pl.x + 16 + t * (pl.w - 32));
    return push(W, foe('shield', x, pl.y - 22, 24, 22, { minX: pl.x + 16, maxX: pl.x + pl.w - 16, dir0: dir, dir, speed: rnd(W, 0.7, 1.05), walkPhase: 0 }));
  }
  function brute(W, pl) {
    if (skipFoe(W, distAt(W, pl.x))) return null;
    const h = heat(distAt(W, pl.x)), per = Math.round(lerp(250, 196, h));
    const x = uniqX(W, pl.x + pl.w * 0.62);
    return push(W, foe('brute', x, pl.y - 17, 36, 34, { minX: pl.x + 34, maxX: pl.x + pl.w - 34, dir0: -1, speed: 0.45, per,
      ph: Math.floor(rng(W) * per), hp: 3, platX0: pl.x, platX1: pl.x + pl.w, platY: pl.y, slamT: -1, waveL: NaN, waveR: NaN, waveX: x, walkPhase: 0 }));
  }
  function bomber(W, x0, x1, y) {
    const cx = (x0 + x1) / 2;
    if (Math.abs(W.S.lastRangedX - cx) < 300 || skipFoe(W, distAt(W, cx))) return null;
    const B = bandAt(W, cx), per = Math.round(B.shootIvl * 60 * 1.05);
    const x = uniqX(W, lerp(x0, x1, 0.8));
    W.S.lastRangedX = cx;
    return push(W, foe('bomber', x, y, 30, 16, { minX: x0, maxX: x1, dir0: -1, speed: rnd(W, 0.9, 1.25), baseY: y, per, f0: Math.floor(rng(W) * per) }));
  }
  function turret(W, pl, t, force) {
    const x = pl.x + t * pl.w;
    if (!force && Math.abs(W.S.lastRangedX - x) < 420) return null;
    if (skipFoe(W, distAt(W, x))) return null;
    const B = bandAt(W, x), per = Math.round(B.shootIvl * 60 * 1.15);
    const ux = uniqX(W, x);
    W.S.lastRangedX = ux;
    return push(W, foe('turret', ux, pl.y - 10, 26, 20, { per, f0: Math.floor(rng(W) * per), aim: Math.PI, hp: 2 }));
  }
  function shard(W, x, y, trail, of) {
    W.G.pickups.push({ type: 'shard', x, y, vy: 0, bob: rng(W) * TAU, grabbed: false, trail, of });
  }
  function trail(W, pl, n) {                    // the classic arc of stars over a slab
    const id = 'w' + (++W.S.trails);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      shard(W, pl.x + 34 + t * Math.max(10, pl.w - 68), pl.y - 54 - Math.sin(t * Math.PI) * 38, id, n);
    }
  }
  function arcStars(W, A, B, n) {               // stars tracing the jump from A's lip to B
    const id = 'w' + (++W.S.trails);
    const x0 = A.x + A.w - 6, x1 = B.x + 26, top = Math.min(A.y, B.y) - 70;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      shard(W, lerp(x0, x1, t), lerp(A.y - 30, B.y - 30, t) - Math.sin(t * Math.PI) * (top < A.y - 110 ? 60 : 70), id, n);
    }
  }
  function ammo(W, x, y, para) {
    W.G.pickups.push({ type: 'ammo', x, y, vy: para ? 0.4 : 0, amt: W.api.CFG.killDropAmt, parachute: !!para, bob: rng(W) * TAU, grabbed: false });
  }
  function starsOn(W, p) { return rng(W) < clamp(p * W.mod.stars, 0, 1); }
  function ammoOn(W, p) { return rng(W) < clamp(p * W.mod.ammo, 0, 1); }
  // A boost pad right at the start of a long slab: the launch (held or not) lands
  // back on the same slab, so the pad is a speed gift, never a trap.
  function boost(W, pl) {
    if (pl.w < 380) return;
    pl.boost = true; pl.boostX = pl.x + 60;
  }
  function crumble(W, pl) { if (!pl.boost) pl.crumble = true; }
  function gaps(W, list) {                      // consecutive main-path pairs [A, B]
    const out = [];
    for (let i = 1; i < list.length; i++) if (list[i].x > list[i - 1].x + list[i - 1].w) out.push([list[i - 1], list[i]]);
    return out;
  }

  /* ---- Terrain patterns: each extends the main path, returns its slabs ---- */
  const TERRAIN = {
    runway(W, lvl) { return [plat(W, lerp(0.35, 0.5, lvl), rnd(W, -18, 18), rnd(W, 360, 460))]; },
    hops(W, lvl) {
      const n = 2 + (rng(W) < 0.5 ? 1 : 0), dy = lerp(14, 58, lvl), out = [];
      for (let i = 0; i < n; i++) {
        const f = gapFrac(W, lvl);
        out.push(plat(W, f, f > 0.7 ? rnd(W, -dy, Math.min(dy, 24)) : rnd(W, -dy, dy), wMid(W, lvl)));
      }
      return out;
    },
    gapLadder(W, lvl) {                         // the lesson inside one segment: each gap wider than the last
      const out = [], base = [0.46, 0.63, 0.78];
      for (let i = 0; i < 3; i++) out.push(plat(W, base[i] + 0.06 * lvl, 0, rnd(W, 200, 250)));
      return out;
    },
    stairsUp(W, lvl) {
      const n = 3, out = [];
      for (let i = 0; i < n; i++) out.push(plat(W, lerp(0.38, 0.62, lvl), rnd(W, 34, lerp(52, 76, lvl)), rnd(W, 160, 220)));
      return out;
    },
    stairsDown(W, lvl) {
      const n = 2 + (rng(W) < 0.5 ? 1 : 0), out = [];
      for (let i = 0; i < n; i++) out.push(plat(W, lerp(0.5, 0.8, lvl), -rnd(W, 40, 82), rnd(W, 180, 240)));
      return out;
    },
    zigzag(W, lvl) {
      const n = 3, out = [], up = rng(W) < 0.5 ? 1 : -1;
      for (let i = 0; i < n; i++) out.push(plat(W, lerp(0.4, 0.64, lvl), ((i & 1) ? -up : up) * rnd(W, 50, lerp(70, 100, lvl)), rnd(W, 180, 240)));
      return out;
    },
    stepping(W, lvl) {                          // precision: narrow stones over short gaps
      const n = 3 + Math.round(lvl * 1.4), out = [];
      for (let i = 0; i < n; i++) out.push(plat(W, lerp(0.3, 0.56, lvl), rnd(W, -24, 24), wNarrow(W)));
      if (ammoOn(W, 0.35)) { const m = out[n >> 1]; ammo(W, m.x + m.w / 2, m.y - 26, false); }
      out.push(plat(W, 0.4, 0, rnd(W, 220, 270)));
      return out;
    },
    longLeap(W, lvl) {                          // one committed leap, stars drawing the line
      const A = plat(W, 0.4, 0, rnd(W, 260, 320));
      const B = plat(W, lerp(0.74, 0.86, lvl), -rnd(W, 0, 24), rnd(W, 320, 380));
      if (starsOn(W, 0.9)) arcStars(W, A, B, 5);
      return [A, B];
    },
    splitPath(W, lvl) {                         // high road (stars) over a low road (aliens), merging after
      // Start low enough that the high road has headroom over the low one.
      const E = plat(W, lerp(0.4, 0.55, lvl), Math.min(0, W.S.last.y - (W.yMin + 140)), rnd(W, 240, 280));
      const L1 = plat(W, 0.28, -rnd(W, 30, 44), rnd(W, 220, 250));
      const L2 = plat(W, lerp(0.34, 0.5, lvl), 0, rnd(W, 220, 260));
      const hy = clamp(E.y - rnd(W, 96, 112), W.yMin, W.yMax);
      const H1 = W.api.newPlatform(L1.x + 70, hy, Math.round(rnd(W, 118, 134)));
      insertPlat(W, H1);
      const H2 = W.api.newPlatform(0, hy + rnd(W, -12, 12), 0);
      const h2end = L2.x + L2.w + rnd(W, -30, 20);
      H2.x = Math.round(Math.max(H1.x + H1.w + 0.42 * reachAt(W.P, H1.y - H2.y), h2end - 150));
      H2.w = Math.round(Math.max(110, h2end - H2.x));
      if (H2.x - (H1.x + H1.w) > reachAt(W.P, H1.y - H2.y) - MARGIN) H2.x = Math.round(H1.x + H1.w + reachAt(W.P, H1.y - H2.y) - MARGIN);
      insertPlat(W, H2);
      trail(W, H1, 3); trail(W, H2, 3);
      // Merge: reachable from both roads' ends.
      const my = clamp(Math.round((L2.y + H2.y) / 2 + 20), W.yMin, W.yMax);
      const lowEnd = L2.x + L2.w, highEnd = H2.x + H2.w;
      const cap = Math.min(lowEnd + reachAt(W.P, L2.y - my) - MARGIN, highEnd + reachAt(W.P, H2.y - my) - MARGIN);
      const mx = Math.min(Math.max(lowEnd, highEnd) + 0.42 * reachAt(W.P, 0), cap);
      const M = W.api.newPlatform(Math.round(mx), my, Math.round(rnd(W, 260, 320)));
      insertPlat(W, M); W.S.last = M;
      W.split = { low: [L1, L2], high: [H1, H2] };
      return [E, L1, L2, M];
    },
    debrisRun(W, lvl) {
      const n = 2 + (rng(W) < lvl ? 1 : 0), out = [];
      for (let i = 0; i < n; i++) { const p = plat(W, lerp(0.42, 0.6, lvl), rnd(W, -20, 20), rnd(W, 170, 230)); crumble(W, p); out.push(p); }
      out.push(plat(W, 0.45, 0, rnd(W, 240, 290)));
      return out;
    },
  };

  /* ---- Enemy garnish: put a focus element onto any terrain --------------- */
  const GARNISH = {
    patrol(W, list, lvl) {
      const wide = list.filter((p) => p.w >= 170 && !p.crumble);
      const n = Math.min(wide.length, count(W, 1 + Math.round(lvl * 1.5)));
      for (let i = 0; i < n; i++) patrol(W, wide[wide.length - 1 - i], rnd(W, 0.35, 0.8), -1);
    },
    shooter(W, list, lvl) {
      const pl = list[list.length > 2 ? list.length - 2 : list.length - 1];
      if (count(W, 1)) shooter(W, pl, lvl > 0.55 && rng(W) < 0.5);
    },
    diver(W, list, lvl) {
      const g = gaps(W, list);
      if (!g.length || !count(W, 1)) return;
      const [A, B] = g[Math.floor(rng(W) * g.length)];
      diverOverGap(W, A, B);
      if (lvl > 0.7 && g.length > 2 && count(W, 1)) { const [C, D] = g[g.length - 1]; if (C !== A) diverOverGap(W, C, D); }
    },
    shield(W, list, lvl) {
      const wide = list.filter((p) => p.w >= 200 && !p.crumble);
      if (wide.length && count(W, 1)) shield(W, wide[wide.length - 1], rnd(W, 0.4, 0.8), -1);
      if (lvl > 0.75 && wide.length > 1 && count(W, 1)) shield(W, wide[0], 0.6, -1);
    },
    bomber(W, list) {
      const a = list[0], z = list[list.length - 1];
      let top = Infinity; for (const p of list) top = Math.min(top, p.y);
      if (count(W, 1)) bomber(W, a.x + 40, z.x + z.w - 40, top - 132);
    },
    turret(W, list) {
      let hi = null; for (const p of list) if (p.w >= 110 && !p.crumble && (!hi || p.y < hi.y)) hi = p;
      if (hi && count(W, 1)) turret(W, hi, 0.7);
    },
    brute(W, list) {
      let wide = null; for (const p of list) if (p.w >= 400 && !p.crumble && (!wide || p.w > wide.w)) wide = p;
      if (wide && count(W, 1)) brute(W, wide);
    },
  };
  // Swoop across the gap at mid-jump height: it never touches a grounded
  // player on either lip, only a mistimed leap.
  function diverOverGap(W, A, B, phase) {
    const lip = A.x + A.w, gap = B.x - lip, top = Math.min(A.y, B.y);
    return diver(W, lip - 40, top - 150, gap + 80, 72, phase);
  }

  /* ---- The segment library ---------------------------------------------
     focus: elements it features · beats: where the director may use it ·
     needs: elements that must be unlocked · w: base weight. */
  const SEGMENTS = {
    // Terrain set pieces
    runway: { focus: ['hop'], beats: 'rest', build(W, lvl) { const [p] = TERRAIN.runway(W, lvl); if (starsOn(W, 0.8)) trail(W, p, 5); if (rng(W) < 0.06 * (W.mod.boost || 1)) boost(W, p); } },
    hops: { focus: ['hop'], beats: 'teach test', build(W, lvl) { const l = TERRAIN.hops(W, lvl); if (starsOn(W, 0.35)) { const g = gaps(W, l); if (g.length) arcStars(W, g[0][0], g[0][1], 4); } } },
    gapLadder: { focus: ['hop'], beats: 'test twist', build(W, lvl) { const l = TERRAIN.gapLadder(W, lvl); if (starsOn(W, 0.7)) arcStars(W, l[1], l[2], 5); } },
    stairsUp: { focus: ['climb'], beats: 'teach test', build(W, lvl) { const l = TERRAIN.stairsUp(W, lvl); if (starsOn(W, 0.4)) trail(W, l[l.length - 1], 3); } },
    stairsDown: { focus: ['climb'], beats: 'test', build(W, lvl) { const l = TERRAIN.stairsDown(W, lvl); if (lvl > 0.4) GARNISH.patrol(W, l.slice(-1), 0); } },
    zigzag: { focus: ['climb'], beats: 'test twist', build(W, lvl) { const l = TERRAIN.zigzag(W, lvl); if (starsOn(W, 0.4)) trail(W, l[1], 3); } },
    introNarrow: { focus: ['narrow'], beats: 'teach', needs: ['narrow'], build(W) { TERRAIN.stepping(W, 0.05); } },
    stepping: { focus: ['narrow'], beats: 'test twist', needs: ['narrow'], build(W, lvl) { TERRAIN.stepping(W, lvl); } },
    longLeap: { focus: ['hop'], beats: 'test twist', build(W, lvl) { TERRAIN.longLeap(W, lvl); } },
    boostLaunch: { focus: ['hop'], beats: 'test rest', minM: 240, build(W, lvl) {
      const pad = plat(W, 0.4, 0, rnd(W, 400, 460)); boost(W, pad);
      const B = plat(W, lerp(0.6, 0.78, lvl), 0, rnd(W, 300, 360));
      const id = 'w' + (++W.S.trails);   // the high road only a boosted jump reaches
      for (let i = 0; i < 4; i++) shard(W, pad.x + pad.w - 30 + i * 60, pad.y - 150 - Math.sin((i + 0.5) / 4 * Math.PI) * 20, id, 4);
      if (lvl > 0.5) GARNISH.patrol(W, [B], 0);
    } },
    splitPath: { focus: ['split'], beats: 'teach test twist', needs: ['split'], build(W, lvl) {
      TERRAIN.splitPath(W, lvl);
      const s = W.split;
      patrol(W, s.low[1], 0.6, -1);
      if (lvl > 0.5) GARNISH[pickEnemy(W, distAt(W, s.low[0].x), ['patrol', 'shield', 'shooter'])](W, s.low, lvl);
    } },
    introDebris: { focus: ['debris'], beats: 'teach', needs: ['debris'], build(W) {
      for (let i = 0; i < 2; i++) crumble(W, plat(W, 0.36, 0, rnd(W, 220, 260)));
      const p = plat(W, 0.4, 0, rnd(W, 320, 380)); trail(W, p, 3);
    } },
    debrisRun: { focus: ['debris'], beats: 'test twist', needs: ['debris'], build(W, lvl) {
      const l = TERRAIN.debrisRun(W, lvl);   // no footing to fight on: the threats come from the air
      GARNISH[pickEnemy(W, distAt(W, l[0].x), ['diver', 'bomber', 'shooter'])](W, l, lvl * 0.6);
    } },
    // Rests
    starRush: { focus: ['hop'], beats: 'rest', build(W) {
      const l = [W.S.last];
      for (let i = 0; i < 2; i++) l.push(plat(W, rnd(W, 0.4, 0.5), rnd(W, -16, 16), rnd(W, 230, 280)));
      for (let i = 1; i < l.length; i++) arcStars(W, l[i - 1], l[i], 4);
      trail(W, l[l.length - 1], 5);
    } },
    luckyCache: { focus: ['hop'], beats: 'rest', minM: 240, build(W) {
      const p = plat(W, 0.4, 0, rnd(W, 400, 460)); boost(W, p);
      ammo(W, p.x + p.w * 0.7, p.y - 150, true); trail(W, p, 5);
    } },
    // Enemy set pieces
    introPatrol: { focus: ['patrol'], beats: 'teach', build(W) {
      const p = plat(W, 0.36, 0, rnd(W, 360, 400));
      patrol(W, p, 0.72, -1, 1.0);
      const id = 'w' + (++W.S.trails);   // stars above the alien: the stomp bounce collects them
      for (let i = 0; i < 3; i++) shard(W, p.x + p.w * 0.72 - 30 + i * 30, p.y - 130 - (i === 1 ? 14 : 0), id, 3);
    } },
    patrolBridge: { focus: ['patrol'], beats: 'test', build(W, lvl) {
      const p = plat(W, gapFrac(W, lvl * 0.7), rnd(W, -20, 20), rnd(W, 440, 520));
      const n = Math.min(4, Math.max(1, count(W, 2 + (lvl > 0.5 ? 1 : 0)))), sp = rnd(W, 62, 88), x0 = p.x + p.w / 2 - sp * (n - 1) / 2;
      const walk = rnd(W, 1.0, 1.6);
      for (let i = 0; i < n; i++) patrol(W, p, (x0 + i * sp - p.x - 14) / (p.w - 28), i < n / 2 ? 1 : -1, walk * rnd(W, 0.85, 1.1));
      if (starsOn(W, 0.6)) { const id = 'w' + (++W.S.trails); for (let i = 0; i < 3; i++) shard(W, x0 + i * sp, p.y - 140, id, 3); }
    } },
    stompSteps: { focus: ['patrol'], beats: 'twist test', build(W, lvl) {
      const n = 2 + (lvl > 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) { const p = plat(W, lerp(0.34, 0.52, lvl), rnd(W, -20, 20), rnd(W, 180, 220)); patrol(W, p, 0.55, -1); }
    } },
    introShooter: { focus: ['shooter'], beats: 'teach', needs: ['shooter'], build(W) {
      const b = plat(W, 0.36, 0, rnd(W, 400, 440));   // resupply first, then the lesson
      ammo(W, b.x + b.w * 0.22, b.y - 26, false); shooter(W, { x: b.x + b.w * 0.55, y: b.y, w: b.w * 0.45 }, false, true);
    } },
    shooterNest: { focus: ['shooter'], beats: 'test twist', needs: ['shooter'], build(W, lvl) {
      const a = plat(W, gapFrac(W, lvl * 0.6), 0, rnd(W, 240, 280)); if (ammoOn(W, 0.8)) ammo(W, a.x + a.w * 0.6, a.y - 26, false);
      const b = plat(W, gapFrac(W, lvl * 0.7), rnd(W, -30, 30), rnd(W, 300, 360));
      shooter(W, b, lvl > 0.5 && rng(W) < 0.6);
      if (lvl > 0.45) patrol(W, b, 0.25, 1);
    } },
    gauntlet: { focus: ['patrol', 'shooter'], beats: 'test twist', build(W, lvl) {
      const n = 2 + (lvl > 0.6 ? 1 : 0), l = [];
      for (let i = 0; i < n; i++) l.push(plat(W, gapFrac(W, lvl * 0.8), rnd(W, -30, 30), rnd(W, 210, 270)));
      for (const p of l) {
        const el = pickEnemy(W, distAt(W, p.x), ['patrol', 'shooter', 'shield', 'turret']);
        if (el === 'patrol') patrol(W, p, rnd(W, 0.4, 0.8), -1);
        else if (el === 'shooter') shooter(W, p, lvl > 0.6 && rng(W) < 0.4);
        else if (el === 'shield') shield(W, p, 0.6, -1);
        else turret(W, p, 0.75);
      }
    } },
    introDiver: { focus: ['diver'], beats: 'teach', needs: ['diver'], build(W) {
      const a = plat(W, 0.4, 0, rnd(W, 320, 360));
      const b = plat(W, 0.48, 0, rnd(W, 360, 400));
      diverOverGap(W, a, b, 0);
      if (starsOn(W, 1)) arcStars(W, a, b, 4);
    } },
    diverGap: { focus: ['diver'], beats: 'test', needs: ['diver'], build(W, lvl) {
      const a = plat(W, 0.42, 0, rnd(W, 250, 300)), b = plat(W, lerp(0.5, 0.72, lvl), rnd(W, -20, 10), rnd(W, 260, 320));
      diverOverGap(W, a, b);
    } },
    diverAlley: { focus: ['diver'], beats: 'twist', needs: ['diver'], build(W, lvl) {
      const l = [W.S.last];
      for (let i = 0; i < 3; i++) l.push(plat(W, lerp(0.46, 0.64, lvl), rnd(W, -24, 24), rnd(W, 190, 240)));
      const d1 = diverOverGap(W, l[0], l[1]);
      // The second swoops on the off-beat of the first: a rhythm, not a wall.
      diverOverGap(W, l[2], l[3], d1 ? d1.ph + (d1.per >> 1) : undefined);
    } },
    introShield: { focus: ['shield'], beats: 'teach', needs: ['shield'], build(W) {
      const b = plat(W, 0.36, 0, rnd(W, 420, 460));   // ammo to try (the shots bounce: that IS the lesson)
      ammo(W, b.x + b.w * 0.15, b.y - 26, false); shield(W, b, 0.75, -1);
    } },
    shieldWall: { focus: ['shield'], beats: 'test twist', needs: ['shield'], build(W, lvl) {
      const p = plat(W, gapFrac(W, lvl * 0.7), rnd(W, -20, 20), rnd(W, 400, 480));
      shield(W, p, 0.75, -1);
      if (lvl > 0.45 && count(W, 1)) shield(W, p, 0.35, 1);
      if (lvl > 0.7) patrol(W, plat(W, gapFrac(W, lvl * 0.6), 0, rnd(W, 220, 260)), 0.6, -1);
    } },
    introBomber: { focus: ['bomber'], beats: 'teach', needs: ['bomber'], build(W) {
      const l = [];
      for (let i = 0; i < 2; i++) l.push(plat(W, 0.4, 0, rnd(W, 270, 310)));
      bomber(W, l[0].x + 40, l[1].x + l[1].w - 40, Math.min(l[0].y, l[1].y) - 132);
    } },
    bombRun: { focus: ['bomber'], beats: 'test twist', needs: ['bomber'], build(W, lvl) {
      const l = TERRAIN.hops(W, lvl * 0.8);
      GARNISH.bomber(W, l, lvl);
      if (lvl > 0.6) GARNISH.patrol(W, l, lvl * 0.5);
    } },
    introBrute: { focus: ['brute'], beats: 'teach', needs: ['brute'], build(W) {
      const p = plat(W, 0.36, 0, rnd(W, 470, 520)); brute(W, p);
      if (starsOn(W, 1)) trail(W, p, 5);
    } },
    bruteArena: { focus: ['brute'], beats: 'test twist', needs: ['brute'], build(W, lvl) {
      const p = plat(W, gapFrac(W, lvl * 0.6), rnd(W, -20, 20), rnd(W, 440, 520)); brute(W, p);
      if (lvl > 0.6) { const q = plat(W, gapFrac(W, lvl * 0.7), 0, rnd(W, 220, 260)); GARNISH[pickEnemy(W, distAt(W, q.x), ['diver', 'shooter', 'patrol'])](W, [p, q], lvl * 0.5); }
    } },
    introTurret: { focus: ['turret'], beats: 'teach', needs: ['turret'], build(W) {
      const a = plat(W, 0.38, 0, rnd(W, 300, 340)); ammo(W, a.x + a.w * 0.4, a.y - 26, false);
      const b = plat(W, 0.4, rnd(W, 50, 64), rnd(W, 240, 280)); turret(W, b, 0.72, true);
    } },
    turretPerch: { focus: ['turret'], beats: 'test twist', needs: ['turret'], build(W, lvl) {
      const l = [];
      for (let i = 0; i < 2; i++) l.push(plat(W, lerp(0.34, 0.5, lvl), rnd(W, -16, 10), unlocked(W, 'narrow', distAt(W, W.S.last.x)) ? wNarrow(W) : rnd(W, 180, 220)));
      const perch = plat(W, 0.42, rnd(W, 60, 80), rnd(W, 200, 240)); turret(W, perch, 0.7, true);
    } },
    crossfire: { focus: ['shooter', 'turret'], beats: 'twist', needs: ['shooter', 'turret'], minM: 2100, build(W, lvl) {
      const a = plat(W, gapFrac(W, lvl * 0.6), 0, rnd(W, 240, 280)); shooter(W, a, true, true);
      const b = plat(W, gapFrac(W, lvl * 0.6), 0, rnd(W, 200, 240)); if (ammoOn(W, 0.9)) ammo(W, b.x + b.w / 2, b.y - 26, false);
      const c = plat(W, 0.45, rnd(W, 40, 60), rnd(W, 220, 260)); turret(W, c, 0.7, true);
    } },
  };
  const IDS = Object.keys(SEGMENTS);

  // A random enemy element unlocked at d, from `pool` (focus-free garnish).
  function pickEnemy(W, d, pool) {
    const ok = pool.filter((el) => unlocked(W, el, d) && W.S.seen[el]);
    return ok.length ? ok[Math.floor(rng(W) * ok.length)] : 'patrol';
  }
  function segOK(W, id, d) {
    const s = SEGMENTS[id];
    if (s.minM && d < s.minM) return false;
    for (const el of s.needs || []) if (!unlocked(W, el, d)) return false;
    return true;
  }
  function weighted(W, list) {
    let sum = 0;
    for (const it of list) sum += it[1];
    let r = rng(W) * sum;
    for (const it of list) { if ((r -= it[1]) < 0) return it[0]; }
    return list[list.length - 1][0];
  }

  /* ---- Twist composer: hard terrain × the focus element (+ a second one) ---- */
  function twist(W, focus, lvl, d) {
    const terr = ['hops', 'zigzag', 'stairsUp', 'gapLadder', 'stairsDown'];
    if (unlocked(W, 'narrow', d)) terr.push('stepping', 'stepping');
    if (unlocked(W, 'debris', d)) terr.push('debrisRun');
    if (focus === 'narrow') terr.length = 0, terr.push('stepping');
    if (focus === 'climb') terr.length = 0, terr.push('zigzag', 'stairsUp', 'stairsDown');
    if (focus === 'debris') terr.length = 0, terr.push('debrisRun');
    const list = TERRAIN[terr[Math.floor(rng(W) * terr.length)]](W, lvl);
    const el = ENEMY_ELEMENTS.indexOf(focus) >= 0 && focus !== 'brute' ? focus : pickEnemy(W, d, ['patrol', 'shooter', 'diver', 'shield', 'bomber', 'turret']);
    GARNISH[el](W, list, lvl);
    if (heat(d) > 0.55 && rng(W) < 0.5) GARNISH[pickEnemy(W, d, ['patrol', 'diver', 'shooter', 'bomber'])](W, list, lvl * 0.6);
  }

  /* ---- The director ------------------------------------------------------ */
  // The opening every run shares: hop, stomp, climb, breathe, shoot, combine, breathe.
  const SCRIPT = [
    ['hops', 'teach', 0.02, 'hop'],
    ['introPatrol', 'teach', 0.1, 'patrol'],
    ['stairsUp', 'teach', 0.15, 'climb'],
    ['runway', 'rest', 0.1, 'hop'],
    ['introShooter', 'teach', 0.1, 'shooter'],
    ['patrolBridge', 'test', 0.2, 'patrol'],
    ['starRush', 'rest', 0.1, 'hop'],
  ];
  function freshElement(W, d) {
    let fresh = null;
    for (const el of ELEMENTS) if (!W.S.seen[el] && unlocked(W, el, d) && (!fresh || W.unlock[el] < W.unlock[fresh])) fresh = el;
    return fresh;
  }
  function newCycle(W, d) {
    const S = W.S, fresh = freshElement(W, d), h = heat(d);
    S.intro = !!fresh;
    // Introduce fast (teach → test); the element's twists come in later cycles.
    if (fresh) { S.focus = fresh; S.beats = h < 0.8 ? ['teach', 'test'] : ['teach', 'test', 'twist']; }
    else {
      // Least-recently-focused elements are likelier: the course keeps rotating.
      const pool = [];
      for (const el of ELEMENTS) if (unlocked(W, el, d) && el !== S.focus) pool.push([el, 1 + S.cycles - (S.focusAt[el] || 0)]);
      S.focus = weighted(W, pool);
      S.beats = h < 0.35 ? ['test', 'twist'] : h < 0.7 ? ['test', 'test', 'twist'] : ['test', 'twist', 'test', 'twist'];
    }
    // The wave breaks on a breather: early every ~3 set pieces, later every ~4-5.
    if (S.sinceRest + S.beats.length >= (h < 0.4 ? 3 : h < 0.75 ? 4 : 5)) S.beats.push('rest');
    S.focusAt[S.focus] = ++S.cycles;
    S.beatIdx = 0;
  }
  function pickRest(W, d) {
    const list = [];
    for (const id of ['runway', 'starRush', 'luckyCache']) if (segOK(W, id, d) && W.S.recent.indexOf(id) < 0) list.push([id, W.mod.weights[id] || 1]);
    return list.length ? weighted(W, list) : 'runway';
  }
  function nextSeg(W, d) {
    const S = W.S;
    const band = W.api.bandFor(d);
    // A sector crossing always lands on a breather. It is already covered only
    // when the segment just before was one; otherwise a rest comes now. That
    // pauses the opening script too, unless the next queued beat (script or
    // cycle) is itself a rest, which then simply runs here.
    if (band > S.lastBand) {
      S.lastBand = band;
      const nextIsRest = S.script.length ? S.script[0][1] === 'rest' : S.beats[S.beatIdx] === 'rest';
      if (S.sinceRest > 0 && !nextIsRest) {
        if (!S.script.length) {   // this breather stands in for the cycle's own, so rests never double up
          const r = S.beats.lastIndexOf('rest');
          if (r >= S.beatIdx) S.beats.splice(r, 1);
        }
        return { id: pickRest(W, d), beat: 'rest', lvl: 0.1, focus: S.focus };
      }
    }
    while (S.script.length) {
      const [id, beat, lvl, focus] = S.script[0];
      if (!segOK(W, id, d)) return { id: 'hops', beat: 'teach', lvl: 0.1, focus: 'hop' };   // wait for the element's band
      S.script.shift();
      S.seen[focus] = true;
      return { id, beat, lvl, focus };
    }
    // A newly unlocked element cuts a routine cycle short: introductions keep their distance.
    // (A pending breather survives the cut.)
    if (!S.intro && S.beatIdx < S.beats.length && S.beats[S.beatIdx] !== 'rest' && freshElement(W, d)) {
      const r = S.beats.indexOf('rest', S.beatIdx);
      S.beatIdx = r >= 0 ? r : S.beats.length;
    }
    if (S.beatIdx >= S.beats.length) newCycle(W, d);
    let beat = S.beats[S.beatIdx++];
    if (S.sinceRest >= 5 && beat !== 'rest') { beat = 'rest'; S.beatIdx--; S.beats.splice(S.beatIdx, 0, 'rest'); S.beatIdx++; }   // never a wall without a breather
    const h = heat(d), focus = S.focus;
    const base = beat === 'teach' ? 0.12 : beat === 'rest' ? 0.1 : beat === 'test' ? 0.3 + 0.5 * h : 0.55 + 0.45 * h;
    const lvl = clamp(base + (rng(W) - 0.5) * 0.12, 0, 1);
    if (beat === 'rest') return { id: pickRest(W, d), beat, lvl, focus };
    if (beat === 'teach' && !S.seen[focus]) { S.seen[focus] = true; return { id: INTRO[focus], beat, lvl: 0.1, focus }; }
    const list = [];
    for (const id of IDS) {
      const s = SEGMENTS[id];
      if (s.focus.indexOf(focus) < 0 || s.beats.indexOf(beat) < 0 || !segOK(W, id, d) || S.recent.indexOf(id) >= 0) continue;
      list.push([id, (W.mod.weights[id] || 1)]);
    }
    if (beat === 'twist') list.push(['twist', 1.2]);
    if (!list.length) {
      for (const id of IDS) if (SEGMENTS[id].beats.indexOf(beat) >= 0 && segOK(W, id, d) && S.recent.indexOf(id) < 0) list.push([id, W.mod.weights[id] || 1]);
    }
    return { id: list.length ? weighted(W, list) : 'hops', beat, lvl, focus };
  }

  /* ---- Public API --------------------------------------------------------- */
  // Called by resetRun after the starter slabs exist. api: rng, newPlatform,
  // patrolAt, bandParams, bandFor, CFG. theme: a SpaceManCourse theme or null.
  function init(G, api, theme) {
    const t = theme || {};
    const mod = { grav: t.grav || 1, enemy: t.enemy || 1, stars: t.stars || 1, ammo: t.ammo || 1, flare: t.flare || 1,
      boost: t.id === 'burn' ? 3 : 1, weights: t.weights || {} };
    const unlock = Object.assign({}, UNLOCK, t.unlock || {});
    const opener = (t.opener || []).map((id) => [id, 'test', 0.25, SEGMENTS[id].focus[0]]);
    const script = SCRIPT.slice(0, 1).concat(opener, SCRIPT.slice(1));
    const S = { last: G.platforms[G.platforms.length - 1], script, beats: [], beatIdx: 0, focus: 'hop', seen: {}, focusAt: {},
      cycles: 0, sinceRest: 0, intro: false, recent: [], ids: [], lastRangedX: -Infinity, trails: 0, lastBand: 0, foes: 0, log: [] };
    const W = { G, api, S, mod, unlock, P: physics(api.CFG, mod.grav), yMin: G.groundY - 200, yMax: G.groundY + 24, seg: [], split: null };
    G.wg = W;
    return W;
  }
  function generate(G) {
    const W = G.wg, S = W.S, target = G.player.x + LOOKAHEAD;
    while (G.genX < target) {
      const x0 = S.last.x + S.last.w, d = distAt(W, x0);
      const seg = nextSeg(W, d);
      W.seg = []; W.split = null;
      const foes0 = S.foes;
      if (seg.id === 'twist') twist(W, seg.focus, seg.lvl, d);
      else SEGMENTS[seg.id].build(W, seg.lvl);
      // Ambient pressure: a test beat that built only terrain picks up one
      // introduced alien as the run heats up (never on a breather or a lesson).
      if (seg.beat === 'test' && S.foes === foes0 && d > 600) {
        const r = rng(W);
        if (r < 0.25 + 0.6 * heat(d)) GARNISH[pickEnemy(W, d, ['patrol', 'shooter', 'diver', 'shield', 'bomber', 'turret'])](W, W.seg, seg.lvl * 0.6);
      }
      // STAR RUSH: stars trace the jumps of every set piece, not just the showcase ones.
      if (W.mod.stars > 1) { const g = gaps(W, W.seg); for (const [A, B] of g) if (rng(W) < (W.mod.stars - 1) * 0.5) arcStars(W, A, B, 4); }
      S.sinceRest = seg.beat === 'rest' ? 0 : S.sinceRest + 1;
      S.recent.push(seg.id); if (S.recent.length > 2) S.recent.shift();
      if (S.log.length < 4000) S.log.push({ id: seg.id, beat: seg.beat, focus: seg.focus, lvl: Math.round(seg.lvl * 1000) / 1000, x0, x1: S.last.x + S.last.w });
    }
    // Cull far-behind slabs (player-relative, so culling can't vary with viewport width).
    while (G.platforms.length > 3 && G.platforms[0].x + G.platforms[0].w < G.player.x - 900) G.platforms.shift();
  }
  window.SpaceManWorld = { MARGIN, LOOKAHEAD, ELEMENTS, UNLOCK, INTRO, SEGMENTS, TERRAIN, SCRIPT,
    simJump, physics, reachAt, heat, init, generate };
})();
