/* Space Man — power-ups, player verbs and joy moments.
   Classic script (loaded before the game script) that defines one global,
   window.SpaceManPowerups. Every function body reads the game's own globals
   (G, input, CFG, ctx, killEnemy, spawnP, ...) at CALL time, so nothing here
   runs until the game is up.

   Rules this file keeps (see tests/powerups.test.cjs):
   - Never draws from the worldgen rng (rng/rnd/burst). Placement is a pure hash
     of the course geometry the seed already produced plus a chunk index, so
     existing seeds and fingerprints are byte-identical and every screen in a
     room sees the same pickups. Visual jitter uses a private xorshift stream.
   - Power-ups are local to the player holding them. Anything that kills an
     alien goes through killEnemy(), which is the shared kill path (NET.kill).
   - Juice (slow-mo, punch zoom) respects Reduce Motion; screen kick rides
     G.kickX/kickY/trauma, which computeShake gates on the Screen Shake setting;
     haptics always go through buzz(); shared rooms never slow the local clock.
   - No per-frame allocation: pools and fixed arrays only. */
(function () {
  'use strict';

  const TYPES = ['jet', 'saber', 'shield', 'magnet'];
  const INFO = {
    jet:    { name: 'JETPACK',    color: '#FF9F4A', rgb: '255,159,74' },
    saber:  { name: 'LIGHTSABER', color: '#6CF2FF', rgb: '108,242,255' },
    shield: { name: 'SHIELD',     color: '#C39BFF', rgb: '195,155,255' },
    magnet: { name: 'MAGNET',     color: '#FF6B8A', rgb: '255,107,138' },
  };
  // Motion per 60 Hz frame, durations in frames (sim steps → deterministic).
  const TUNE = {
    // One pickup opportunity per chunk of course: 3500px = 350m ≈ 9s at full
    // run. Chunk 1 opens at 170m and always carries one, so every run gets an
    // early taste; after that ~72% of chunks do (≈ one per 12s of running).
    chunkPx: 3500, firstPx: 1700, chance: 0.72,
    weights: [0.32, 0.30, 0.20, 0.18],           // jet, saber, shield, magnet
    grabR: 26,
    // JETPACK: hold jump in the air to thrust. A tank is 96 frames (1.6s) of
    // thrust; it refills on the ground, on any kill and through sky rings. The
    // pack itself burns out after `life` frames, and a soft ceiling caps height,
    // so it can never fly forever or leave the course behind.
    jet: { life: 660, drain: 1 / 96, refillGround: 1 / 24, refillKill: 0.3, refillRing: 0.5,
      acc: 1.25, brake: 0.35, climb: -6, ceiling: 200, soft: 70, riseFirst: -4 },
    // LIGHTSABER: FIRE swings instead of shooting. Frames 0..parry of a swing
    // reflect shots straight back at their shooter; parry+1..active cut them.
    saber: { life: 600, swing: 16, active: 12, parry: 8, rearm: 11, reach: 52, bulletPad: 10 },
    // SHIELD: eats one contact or bullet hit, then i-frames. Never saves a fall
    // or the flare: those are the run's real stakes.
    shield: { life: 1200, iframes: 50 },
    // MAGNET: pulls shards, ammo and other pickups from far away.
    magnet: { life: 660, reach: 190, pull: 0.16 },
    warn: 120,                                     // last 2s blink + tick
  };

  /* ---- pure placement -------------------------------------------------------
     fmix32-style avalanche over small integers. Keyed by chunk index and the
     quantized geometry of the platform that opens the chunk — itself a pure
     function of the seed — so it needs no seed plumbing and can't drift. */
  function mix(h, v) {
    h ^= v | 0; h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35); return (h ^ (h >>> 16)) >>> 0;
  }
  function platKey(pl) { return mix(mix(mix(0x9E3779B9, Math.round(pl.x * 8)), Math.round(pl.y * 8)), Math.round(pl.w * 8)); }
  const frac = (h) => h / 4294967296;
  // Chunk 0 is the opening stretch (no pickups); chunk 1 starts at firstPx.
  function chunkOf(x, startX) { return Math.floor((x - startX - TUNE.firstPx) / TUNE.chunkPx) + 1; }
  // The pickup (or null) a platform carries, given the platform before it.
  function placeFor(pl, prev, startX) {
    if (!prev || pl.fallen) return null;
    const c = chunkOf(pl.x, startX);
    if (c < 1 || c <= chunkOf(prev.x, startX)) return null;   // not the chunk opener
    const k = mix(platKey(pl), c);
    if (c > 1 && frac(mix(k, 1)) >= TUNE.chance) return null;
    let r = frac(mix(k, 2)), type = TYPES[TYPES.length - 1];
    for (let i = 0; i < TYPES.length; i++) { if (r < TUNE.weights[i]) { type = TYPES[i]; break; } r -= TUNE.weights[i]; }
    return { type, x: pl.x + Math.min(90, pl.w * 0.4), y: pl.y - 28, c };
  }
  // A sky ring over a wide gap: the jetpack's upper layer (inert without one).
  function ringFor(pl, prev) {
    if (!prev) return null;
    const gap = pl.x - (prev.x + prev.w);
    if (gap < 150 || frac(mix(platKey(pl), 7)) >= 0.45) return null;
    const ceil = G.groundY - TUNE.jet.ceiling;
    return { x: prev.x + prev.w + gap / 2, y: Math.max(ceil + 26, Math.min(prev.y, pl.y) - 120) };
  }

  /* ---- per-run state --------------------------------------------------------- */
  const REFL_CAP = 6, CUT_CAP = 4;
  const S = {
    player: null, scanX: -Infinity, items: [], rings: [], frame: 0,
    jet: 0, fuel: 0, thrust: false, thrustF: 0, sputter: 0,
    saber: 0, swingT: -1, swingDir: 1, swingHit: 0,
    shield: 0, invul: 0, magnet: 0,
    refl: [], cuts: [],
    picked: 0, parries: 0, saberKills: 0, joys: 0, flew: 0,
    kills: 0, streak: 0, lastKillF: -999, chain: 0, maxShown: false,
    grazeN: 0, grazeF: -999, prevGround: true, air: 0, lastPlat: null, flow: 0,
    prevCx: 0, mile: 0, milePending: 0, cheerF: -999,
    head: { text: '', sub: '', color: '#FFE59A', t: 0, max: 1 },
    fx: 0x2545F491, jetSnd: null,
  };
  for (let i = 0; i < REFL_CAP; i++) S.refl.push({ live: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, target: null });
  for (let i = 0; i < CUT_CAP; i++) S.cuts.push({ t: 0, x: 0, y: 0, a: 0 });

  function reset(p) {
    S.player = p; S.scanX = -Infinity; S.items.length = 0; S.rings.length = 0; S.frame = 0;
    S.jet = 0; S.fuel = 0; S.thrust = false; S.thrustF = 0; S.sputter = 0;
    S.saber = 0; S.swingT = -1; S.swingDir = 1; S.swingHit = 0;
    S.shield = 0; S.invul = 0; S.magnet = 0;
    for (const r of S.refl) { r.live = false; r.target = null; }
    for (const c of S.cuts) c.t = 0;
    S.picked = 0; S.parries = 0; S.saberKills = 0; S.joys = 0; S.flew = 0;
    S.kills = G.killsRun; S.streak = 0; S.lastKillF = -999; S.chain = G.chain; S.maxShown = false;
    S.grazeN = 0; S.grazeF = -999; S.prevGround = p.onGround; S.air = 0; S.lastPlat = p.groundPlat; S.flow = 0;
    S.prevCx = p.x + p.w / 2; S.mile = Math.floor(G.dist / 500); S.milePending = 0; S.cheerF = -999;
    S.head.t = 0; S.fx = 0x2545F491;
    stopJetSound();
    // QA: #shot=play&pu=jet grants a power-up on frame 1 for screenshots.
    if (typeof SHOT !== 'undefined' && SHOT && typeof HASH !== 'undefined' && INFO[HASH.pu]) grant(HASH.pu, true);
  }
  function fxr() { let x = S.fx; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; S.fx = x >>> 0; return S.fx / 4294967296; }
  function live() { return S.player === G.player && G.player && !G.player.dead; }

  /* ---- placement scan: runs every play tick, pure reads of G.platforms ---- */
  function scan() {
    const pls = G.platforms;
    for (let i = 1; i < pls.length; i++) {
      const pl = pls[i];
      if (pl.x <= S.scanX) continue;
      S.scanX = pl.x;
      const it = placeFor(pl, pls[i - 1], G.startX);
      if (it) { it.bob = (it.c * 1.7) % 6.28; it.taken = false; it.t = 0; S.items.push(it); }
      const rg = ringFor(pl, pls[i - 1]);
      if (rg) { rg.taken = false; rg.t = 0; S.rings.push(rg); }
    }
    const behind = G.player.x - 900;
    while (S.items.length && S.items[0].x < behind) S.items.shift();
    while (S.rings.length && S.rings[0].x < behind) S.rings.shift();
  }

  /* ---- granting + timers ---- */
  function grant(type, quiet) {
    const p = G.player, T = TUNE[type];
    if (type === 'jet') { S.jet = T.life; S.fuel = 1; }
    else if (type === 'saber') { S.saber = T.life; S.swingT = -1; }
    else if (type === 'shield') { S.shield = T.life; }
    else if (type === 'magnet') { S.magnet = T.life; }
    S.picked++;
    if (quiet) return;
    const I = INFO[type], cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    G.score += 15;
    G.freeze = Math.max(G.freeze, 0.05);
    spawnP(cx, cy, 0, 0, 22, 3, I.color, 0, false, 3);
    spawnP(cx, cy, 0, 0, 30, 3, 'rgba(255,255,255,.8)', 0, false, 3);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, s = 2.2 + fxr() * 1.6;
      spawnP(cx, cy, Math.cos(a) * s, Math.sin(a) * s, 22 + fxr() * 10, 2.4, I.color, 0.03, false, 0);
    }
    headline(I.name + '!', hintFor(type), I.color, type === 'jet' || S.picked === 1 ? 2.4 : 1.8);
    sfx.pickup(type);
    buzz('success');
    cheer();
    if (typeof announceMoment === 'function') announceMoment(I.name.toLowerCase() + ': ' + hintFor(type).toLowerCase() + '.');
  }
  function hintFor(type) {
    const pad = input.usingGamepad, touch = (typeof FORCE_TOUCH !== 'undefined' && FORCE_TOUCH) || input.usingTouch;
    if (type === 'jet') {
      if (touch) return 'HOLD ' + (settings.lefty ? 'LEFT' : 'RIGHT') + ' SIDE TO FLY · STICK STEERS';
      if (pad) return 'HOLD JUMP TO FLY';
      return 'HOLD ' + keyLabel(settings.keys.jump) + ' / SPACE TO FLY';
    }
    if (type === 'saber') {
      if (touch) return 'TAP SABER · SWING INTO SHOTS TO REFLECT';
      if (pad) return 'FIRE TO SLASH · TIME IT TO REFLECT';
      return keyLabel(settings.keys.fire) + ' / CLICK TO SLASH · TIME IT TO REFLECT';
    }
    if (type === 'shield') return 'BLOCKS ONE HIT';
    return 'PULLS IN STARS + AMMO';
  }
  function headline(text, sub, color, secs) {
    const h = S.head; h.text = text; h.sub = sub || ''; h.color = color || '#FFE59A'; h.t = h.max = secs || 1.4;
  }
  function tickTimers(p) {
    if (S.jet > 0) {
      if (p.onGround) S.fuel = Math.min(1, S.fuel + TUNE.jet.refillGround);
      if (--S.jet === TUNE.warn) sfx.warn();
      if (S.jet <= 0) expire('jet', p);
    }
    if (S.saber > 0) { if (--S.saber === TUNE.warn) sfx.warn(); if (S.saber <= 0) expire('saber', p); }
    if (S.shield > 0) { if (--S.shield === TUNE.warn) sfx.warn(); if (S.shield <= 0) expire('shield', p); }
    if (S.magnet > 0) { if (--S.magnet === TUNE.warn) sfx.warn(); if (S.magnet <= 0) expire('magnet', p); }
    if (S.invul > 0) S.invul--;
    if (S.sputter > 0) S.sputter--;
  }
  function expire(type, p) {
    if (type === 'jet') { S.fuel = 0; S.thrust = false; stopJetSound(); }
    if (type === 'saber') S.swingT = -1;
    popup(p.x, p.y - 26, INFO[type].name + ' OUT', 'rgba(' + INFO[type].rgb + ',.9)');
    sfx.expire();
  }

  function grabItems(p) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = TUNE.grabR;
    for (const it of S.items) {
      it.bob += 0.07;
      if (it.taken) { it.t++; continue; }
      if (S.magnet > 0) {
        const dx = cx - it.x, dy = cy - it.y, M = TUNE.magnet;   // the same reach and pull as shards and ammo
        if (dx * dx + dy * dy < M.reach * M.reach) { it.x += dx * M.pull; it.y += dy * M.pull; }
      }
      const dx = it.x - cx, dy = it.y - cy;
      if (dx * dx + dy * dy < R * R) { it.taken = true; it.t = 0; grant(it.type); }
    }
    if (S.jet > 0) for (const rg of S.rings) {
      if (rg.taken) { rg.t++; continue; }
      if (Math.abs(rg.x - cx) < 16 && Math.abs(rg.y - cy) < 24) {
        rg.taken = true; rg.t = 0;
        S.fuel = Math.min(1, S.fuel + TUNE.jet.refillRing);
        G.score += 20; popup(rg.x, rg.y - 24, 'SKY RING +20', '#FFC08A');
        spawnP(rg.x, rg.y, 0, 0, 20, 3, INFO.jet.color, 0, false, 3);
        sfx.ring(); buzz('select');
      }
    }
  }
  // Magnet: the game's own pickup loop grabs at 18px; we only move things closer.
  function magnetPull(p) {
    if (S.magnet <= 0) return;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = TUNE.magnet.reach, k = TUNE.magnet.pull;
    for (const it of G.pickups) {
      if (it.grabbed) continue;
      const dx = cx - it.x, dy = cy - it.y;
      if (dx * dx + dy * dy < R * R) { it.x += dx * k; it.y += dy * k; it.parachute = false; it.vy = 0; }
    }
  }

  /* ---- JETPACK: called from updatePlayer() right after gravity ---- */
  function jet(p) {
    const was = S.thrust;
    S.thrust = false;
    if (S.jet <= 0 || S.player !== p || p.onGround || p.hang || p.dead) { if (was) stopJetSound(); return; }
    if (!input.jumpHeld) { if (was) stopJetSound(); return; }
    if (p.jumping && p.vy < TUNE.jet.riseFirst) { if (was) stopJetSound(); return; }   // the jump's own rise plays out first
    if (S.fuel <= 0) {
      if (was || S.sputter === 0) { sfx.sputter(); S.sputter = 40; smoke(p); }
      if (was) stopJetSound();
      return;
    }
    const J = TUNE.jet, ceil = G.groundY - J.ceiling;
    const k = clamp((p.y - ceil) / J.soft, 0, 1);   // 1 well below the ceiling → 0 at it
    p.vy -= J.acc + (p.vy > 0 ? J.brake : 0);        // net lift over gravity; brakes a fall harder
    const cap = J.climb * k;                         // climb speed fades to a hover at the ceiling
    if (p.vy < cap) p.vy = cap;
    S.fuel = Math.max(0, S.fuel - J.drain);
    S.thrust = true; S.thrustF++; S.flew++;
    p.airFrames = Math.max(0, p.airFrames - 1);       // flying isn't a BIG AIR leap
    if (!was) { if (G.mode === 'play') buzz('light'); startJetSound(); }
    else if (S.thrustF % 6 === 0) jetSoundLevel(1 - k);
    flame(p);
    if (S.fuel <= 0) { sfx.sputter(); S.sputter = 40; stopJetSound(); smoke(p); }
  }
  // Scalars, not an array: this runs every thrust frame on phones.
  function nozzleX(p) { return p.x + p.w / 2 - p.facing * 12.5; }
  function nozzleY(p) { return p.y + p.h / 2 + 12; }
  function flame(p) {
    const nx = nozzleX(p), ny = nozzleY(p);
    spawnP(nx + (fxr() - 0.5) * 3, ny, p.vx * 0.2 + (fxr() - 0.5) * 0.8, 2.4 + fxr() * 1.6, 12 + fxr() * 6, 2.6, fxr() < 0.5 ? 'rgba(255,201,60,.95)' : 'rgba(255,120,60,.9)', 0.02, false, 0);
    if (S.thrustF % 3 === 0) spawnP(nx, ny + 6, (fxr() - 0.5) * 0.6, 1.2 + fxr(), 26, 3.2, 'rgba(200,210,235,.35)', -0.01, false, 0);
  }
  function smoke(p) {
    const nx = nozzleX(p), ny = nozzleY(p);
    for (let i = 0; i < 4; i++) spawnP(nx, ny, (fxr() - 0.5) * 1.2, 0.5 + fxr(), 26, 3, 'rgba(160,170,190,.5)', -0.01, false, 0);
  }

  /* ---- LIGHTSABER ---- */
  // Is any FIRE input held right now? key, mouse button, controller trigger/button, or the touch button.
  function fireHeld() { return !!(input.fireKey || input.fireMouse || input.firePad || input.shootBtn.pressed); }
  // tryShoot() asks first: true means the saber owns FIRE right now.
  function fire() {
    if (S.saber <= 0 || S.player !== G.player) return false;
    if (S.swingT < 0 || S.swingT >= TUNE.saber.rearm) {
      S.swingT = 0; S.swingDir = -S.swingDir; S.swingHit = 0;
      sfx.swing(S.swingDir);
      if (G.mode === 'play') buzz('select');
      flags.taughtShoot = true;
    }
    return true;
  }
  // Called between updateEnemies() and updateBullets(): aliens are where they
  // are this frame, shots haven't moved yet.
  function combat() {
    const p = G.player;
    if (S.player !== p) return;
    if (S.saber > 0 && !p.dead && fireHeld()) fire();   // holding FIRE on any device keeps swinging (fire() ignores it mid-swing)
    if (!p.dead && S.saber > 0 && S.swingT >= 0) {
      const A = TUNE.saber, f = S.swingT, cx = p.x + p.w / 2, cy = p.y + p.h / 2 - 2;
      if (f <= A.active) {
        for (const e of G.enemies) {
          if (e.dead || !inArc(cx, cy, p.facing, e.x, e.y, A.reach + Math.max(e.w, e.h) * 0.5)) continue;
          slash(e, p);
        }
        for (let i = G.ebullets.length - 1; i >= 0; i--) {
          const b = G.ebullets[i];
          if (!inArc(cx, cy, p.facing, b.x, b.y, A.reach + A.bulletPad)) continue;
          G.ebullets.splice(i, 1);
          if (f <= A.parry) reflect(b, p); else cutShot(b, p);
        }
      }
      if (++S.swingT > A.swing) S.swingT = -1;
    }
    updateRefl();
    for (const c of S.cuts) if (c.t > 0) c.t--;
  }
  // Front half-disc around the chest: straight overhead (dx = 0) is in, anything even a hair behind is out.
  function inArc(cx, cy, facing, x, y, r) {
    const dx = x - cx, dy = y - cy;
    return dx * facing >= 0 && dx * dx + dy * dy <= r * r;
  }
  function slash(e, p) {
    const interrupted = e.type === 'shoot' && e.telegraph > 0;
    killEnemy(e, 'slash', interrupted);   // the shared kill path: NET.kill in a room
    S.saberKills++; S.swingHit++;
    airChain(p);
    const c = nextCut(); c.t = 10; c.x = e.x; c.y = e.y; c.a = S.swingDir > 0 ? 0.6 : -0.6;
  }
  // killEnemy() hands slash kills back here for their feel (sound, hit-stop, kick).
  function slashKill(e) {
    const p = G.player;
    sfx.hit(G.chain);
    G.freeze = Math.max(G.freeze, 0.07);
    G.trauma = Math.min(1, G.trauma + 0.18);
    G.kickX = (p ? p.facing : 1) * 6; G.kickY = -2; G.kickAt = G.time;
    for (let i = 0; i < 6; i++) spawnP(e.x, e.y, (fxr() - 0.5) * 5, (fxr() - 0.5) * 5, 14 + fxr() * 8, 2, INFO.saber.color, 0.05, false, 0);
    buzz('heavy');
  }
  function airChain(p) {
    if (!p || p.onGround || p.dead) return;
    G.bestChainRun = Math.max(G.bestChainRun, 1 << G.chain);
    G.chain = Math.min(G.chain + 1, CFG.chainCap);
    if (G.chain >= 3 && !lessMotion()) G.twirlT = 0.22;
    airChainProgress();
  }
  function nextCut() { let best = S.cuts[0]; for (const c of S.cuts) if (c.t < best.t) best = c; return best; }
  function reflect(b, p) {
    // Straight back up the line it came in on, locked onto the nearest shooter
    // along that line — RETURN TO SENDER.
    const sp = Math.hypot(b.vx, b.vy) || 1, ux = -b.vx / sp, uy = -b.vy / sp;
    // The alien that actually fired it, if it is still there; otherwise the best-lined-up shooter, otherwise straight back.
    let target = b.src && !b.src.dead && G.enemies.indexOf(b.src) >= 0 ? b.src : null, best = 0.6;
    if (!target) for (const e of G.enemies) {
      if (e.dead || e.type !== 'shoot') continue;
      const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy);
      if (d > 800 || d < 1) continue;
      const dot = (dx * ux + dy * uy) / d;
      if (dot > best) { best = dot; target = e; }
    }
    let r = S.refl[0];
    for (const q of S.refl) if (!q.live) { r = q; break; }
    const v = Math.max(9, sp * 2.6);
    let dx = ux, dy = uy;
    if (target) { const d = Math.hypot(target.x - b.x, target.y - b.y) || 1; dx = (target.x - b.x) / d; dy = (target.y - b.y) / d; }
    r.live = true; r.x = r.px = b.x; r.y = r.py = b.y; r.vx = dx * v; r.vy = dy * v; r.life = 100; r.target = target;
    S.parries++;
    G.score += 15; popup(b.x, b.y - 12, 'PARRY +15', '#9FF1FF');
    G.freeze = Math.max(G.freeze, 0.07);
    slowmo(0.5, 0.16);
    G.trauma = Math.min(1, G.trauma + 0.12); G.kickX = -p.facing * 4; G.kickY = 0; G.kickAt = G.time;
    spawnP(b.x, b.y, 0, 0, 16, 3, '#F4F7FF', 0, false, 3);
    for (let i = 0; i < 5; i++) spawnP(b.x, b.y, dx * 3 + (fxr() - 0.5) * 3, dy * 3 + (fxr() - 0.5) * 3, 14, 2, INFO.saber.color, 0, false, 0);
    sfx.parry(); buzz('heavy');
  }
  function cutShot(b, p) {
    G.score += 5; popup(b.x, b.y - 10, '+5 CUT', '#CFE3FF');
    for (let i = 0; i < 4; i++) spawnP(b.x, b.y, (fxr() - 0.5) * 4, (fxr() - 0.5) * 4, 12, 2, 'rgba(200,160,255,.9)', 0.05, false, 0);
    sfx.cut(); buzz('light');
  }
  function updateRefl() {
    const p = G.player;
    for (const r of S.refl) {
      if (!r.live) continue;
      r.px = r.x; r.py = r.y;
      const t = r.target;
      if (t && !t.dead) {   // gentle homing: shooters bob, some shots were leading the player
        const sp = Math.hypot(r.vx, r.vy), d = Math.hypot(t.x - r.x, t.y - r.y) || 1;
        r.vx += ((t.x - r.x) / d * sp - r.vx) * 0.15; r.vy += ((t.y - r.y) / d * sp - r.vy) * 0.15;
      }
      r.x += r.vx; r.y += r.vy;
      if (--r.life <= 0 || Math.abs(r.x - p.x) > 1400) { r.live = false; r.target = null; continue; }
      for (const e of G.enemies) {
        if (e.dead || Math.abs(r.x - e.x) > e.w * 0.6 + 3 || Math.abs(r.y - e.y) > e.h * 0.7 + 3) continue;
        killEnemy(e, 'shoot', e.type === 'shoot' && e.telegraph > 0);
        G.score += 25; popup(e.x, e.y - 34, 'RETURN TO SENDER +25', '#9FF1FF');
        airChain(p);
        spawnP(r.x, r.y, 0, 0, 16, 3, INFO.saber.color, 0, false, 3);
        r.live = false; r.target = null;
        headline('RETURN TO SENDER', '', INFO.saber.color, 1.2);
        break;
      }
    }
  }

  /* ---- SHIELD: the contact and bullet death paths ask first ---- */
  // e: the alien touched (null for a bullet). True means "don't die".
  function guard(e) {
    const p = G.player;
    if (S.player !== p || p.dead) return false;
    if (S.invul > 0) return true;
    if (S.shield <= 0) return false;
    S.shield = 0; S.invul = TUNE.shield.iframes;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (e && !e.dead) killEnemy(e, 'shield', false);
    p.vy = Math.min(p.vy, -8); p.jumping = false; p.onGround = false;
    popup(p.x, p.y - 30, 'SHIELD SAVE!', INFO.shield.color);
    headline('SAVED!', '', INFO.shield.color, 1.1);
    spawnP(cx, cy, 0, 0, 26, 3, INFO.shield.color, 0, false, 3);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; spawnP(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, Math.cos(a) * 2.6, Math.sin(a) * 2.6, 20, 2.4, INFO.shield.color, 0.04, false, 0); }
    G.freeze = Math.max(G.freeze, 0.07); slowmo(0.4, 0.3);
    G.trauma = Math.min(1, G.trauma + 0.3);
    sfx.pop(); buzz('warn');
    return true;
  }

  /* ---- JOY: reads state deltas once per tick, writes score/popups/fx ---- */
  function slowmo(scale, secs) {
    if (lessMotion() || G.sharedWorld || G.mode !== 'play') return;   // a room's clock never waits for one screen
    G.timescale = Math.min(G.timescale, scale); G.slowTimer = Math.max(G.slowTimer, secs);
  }
  function cheer() {
    const c = G.companion;
    if (!c || S.frame - S.cheerF < 120) return;
    S.cheerF = S.frame; c.loopT = 0.8; Audio.sfx.chirp();
  }
  function joy(p) {
    // Multi-kill streaks: kills landing within 1.6s of each other.
    if (G.killsRun > S.kills) {
      const n = G.killsRun - S.kills;
      S.streak = S.frame - S.lastKillF <= 96 ? S.streak + n : n;
      S.lastKillF = S.frame;
      if (S.jet > 0) S.fuel = Math.min(1, S.fuel + TUNE.jet.refillKill * n);
      if (S.streak >= 2) {
        const tier = Math.min(S.streak, 4), pts = [0, 0, 25, 50, 100][tier];
        const word = ['', '', 'DOUBLE!', 'TRIPLE!', 'RAMPAGE!'][tier];
        G.score += pts; popup(p.x, p.y - 44, word + ' +' + pts, '#FFC93C');
        if (tier >= 3) { headline(word, S.streak > 4 ? S.streak + ' IN A ROW' : '', '#FFC93C', 1.2); cheer(); }
        Audio.sfx.medal(Math.min(3, tier - 1)); buzz(tier >= 3 ? 'celebrate' : 'success');
        S.joys++;
      }
    }
    S.kills = G.killsRun;
    // Chain: big stomps get a slow-mo flourish; hitting the cap gets a banner;
    // banking ×8 or more throws confetti on top of the game's own bank popup.
    if (G.chain > S.chain) {
      if (G.chain >= 3 && p.vy <= CFG.stompBounce + 0.5) {
        slowmo(0.4, 0.22); G.punchZoom = Math.max(G.punchZoom, 1.06); G.punchTimer = 0.12;
        const cx = p.x + p.w / 2, fy = p.y + p.h;
        spawnP(cx, fy, 0, 0, 20, 3, '#FFC93C', 0, false, 3);
        for (let i = 0; i < 8; i++) spawnP(cx, fy, (i - 3.5) * 0.9, 0.6 + fxr(), 16, 2.2, '#FFE59A', 0.1, false, 0);
      }
      if (G.chain >= CFG.chainCap && !S.maxShown) {
        S.maxShown = true; headline('MAX CHAIN ×' + (1 << CFG.chainCap), 'LAND TO BANK IT', '#FFC93C', 1.4); cheer(); S.joys++;
      }
    }
    if (S.chain >= 3 && G.chain === 0 && p.onGround) {
      const mult = 1 << S.chain, cx = p.x + p.w / 2;
      headline('JACKPOT ×' + mult, '', '#FFC93C', 1.3);
      confetti(cx, p.y);
      Audio.sfx.medal(3); buzz('celebrate'); cheer(); S.joys++;
    }
    if (G.chain === 0) S.maxShown = false;
    S.chain = G.chain;
    // Close-call streaks: grazes (the game already scores each one) within 3s.
    for (const b of G.ebullets) {
      if (!b.grazed || b.pj) continue;
      b.pj = true;
      S.grazeN = S.frame - S.grazeF <= 180 ? S.grazeN + 1 : 1; S.grazeF = S.frame;
      if (S.grazeN === 2) { G.score += 10; popup(p.x, p.y - 40, 'CLOSE CALL ×2 +10', '#FFE59A'); }
      else if (S.grazeN >= 3) {
        const pts = S.grazeN === 3 ? 40 : 80;
        G.score += pts; headline(S.grazeN === 3 ? 'DAREDEVIL!' : 'UNTOUCHABLE!', '+' + pts, '#FFE59A', 1.3);
        slowmo(0.45, 0.25); cheer(); buzz('success'); Audio.sfx.discover(); S.joys++;
      }
    }
    // Landings: CLUTCH (feet on the very lip) and FLOW (new slab after new slab at speed).
    if (!p.onGround) S.air++;
    else if (!S.prevGround) {
      const pl = p.groundPlat, cx = p.x + p.w / 2;
      if (pl && S.air > 20) {
        if (cx < pl.x + 6 || cx > pl.x + pl.w - 6) {
          G.score += 15; popup(p.x, p.y - 30, 'CLUTCH! +15', '#9FF1FF');
          slowmo(0.6, 0.1); sfx.clutch(); buzz('select'); S.joys++;
        }
        if (pl !== S.lastPlat) {
          S.flow = Math.abs(p.vx) > 4 ? S.flow + 1 : 1;
          if (S.flow >= 4 && S.flow % 4 === 0) {
            const lvl = S.flow / 4, pts = 10 * Math.min(lvl, 5);
            G.score += pts; popup(p.x, p.y - 44, 'FLOW ×' + S.flow + ' +' + pts, '#9FF1FF');
            sfx.flow(lvl); if (lvl >= 2) cheer(); S.joys++;
          }
        }
      }
      S.lastPlat = pl; S.air = 0;
    }
    if (p.onGround && Math.abs(p.vx) < 1) S.flow = 0;
    S.prevGround = p.onGround;
    // Vault: sailing just over a live alien without stomping it.
    const cx = p.x + p.w / 2, feet = p.y + p.h;
    if (!p.onGround) for (const e of G.enemies) {
      if (e.dead || e.pv) continue;
      if ((S.prevCx - e.x) * (cx - e.x) > 0) continue;   // didn't cross its centre this tick
      const clear = (e.y - e.h / 2) - feet;
      if (clear < 0 || clear > 30 || p.vy > 2) continue;
      e.pv = true; G.score += 10; popup(e.x, e.y - 26, 'VAULT +10', '#CFE3FF'); sfx.clutch();
    }
    S.prevCx = cx;
    // Milestone fanfares every 500m (1000m has the game's own stinger); they
    // wait for a quiet beat so they never stack on a sector card.
    const m = Math.floor(G.dist / 500);
    if (m > S.mile) { S.mile = m; if (m * 500 !== 1000) S.milePending = m; }
    if (S.milePending && G.stinger <= 0 && G.celebrate <= 0 && S.head.t <= 0) {
      headline('★ ' + S.milePending * 500 + 'm', 'KEEP RUNNING', '#9FF1FF', 1.4);
      confetti(p.x + p.w / 2, p.y);
      Audio.sfx.discover(); buzz('success'); cheer();
      S.milePending = 0;
    }
  }
  function confetti(x, y) {
    const n = lessMotion() ? 8 : 22, cols = ['#FFC93C', '#9FF1FF', '#FF6B8A', '#C39BFF', '#4EF07A'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (fxr() - 0.5) * 2.2, s = 2.5 + fxr() * 3;
      spawnP(x, y, Math.cos(a) * s, Math.sin(a) * s, 34 + fxr() * 20, 2.4, cols[i % 5], 0.12, false, 0);
    }
  }

  /* ---- per-tick entry point (update(), after collisions) ---- */
  function update() {
    const p = G.player;
    if (!p) return;
    if (S.player !== p) reset(p);
    S.frame++;
    if (S.head.t > 0) S.head.t = Math.max(0, S.head.t - 1 / 60);
    if (p.dead) { S.thrust = false; stopJetSound(); return; }
    scan();
    grabItems(p);
    magnetPull(p);
    tickTimers(p);
    joy(p);
  }

  /* ---- audio: small synth voices on the game's sfx bus (in key where musical) ---- */
  const syn = () => (typeof Audio !== 'undefined' && Audio.synth) || null;
  const sfx = {
    pickup(type) {
      const A = syn(); if (!A || !A.ctx) return;
      const t = A.ctx.currentTime, ct = A.chordTones(3);
      ct.forEach((f, i) => A.tone('triangle', f * 2, f * 2, 0.08, 0.16, undefined, t + i * 0.05));
      A.tone('sine', ct[0] * 4, ct[0] * 4, 0.3, 0.1, undefined, t + 0.16);
      if (type === 'saber') { A.tone('sawtooth', 90, 420, 0.28, 0.07, undefined, t); A.noise(0.25, 0.05, 'bandpass', 1400); }
      if (type === 'jet') A.noise(0.3, 0.08, 'lowpass', 700);
      if (type === 'shield') A.tone('sine', 520, 1040, 0.25, 0.06, undefined, t + 0.05);
    },
    warn() { const A = syn(); if (!A || !A.ctx) return; const t = A.ctx.currentTime; A.tone('square', 880, 880, 0.03, 0.05, undefined, t); A.tone('square', 880, 880, 0.03, 0.05, undefined, t + 0.18); },
    expire() { const A = syn(); if (!A || !A.ctx) return; const t = A.ctx.currentTime; [5, 3, 1].forEach((d, i) => { const f = A.degF(d, 1); A.tone('triangle', f, f, 0.08, 0.1, undefined, t + i * 0.07); }); },
    swing(dir) { const A = syn(); if (!A) return; A.tone('sawtooth', dir > 0 ? 260 : 220, dir > 0 ? 110 : 95, 0.14, 0.06); A.noise(0.12, 0.07, 'bandpass', dir > 0 ? 1600 : 1300); },
    hit(level) { const A = syn(); if (!A) return; A.noise(0.08, 0.2, 'highpass', 2200); A.tone('square', 1400, 500, 0.06, 0.1); const f = A.degF([1, 2, 3, 5][clamp(level, 0, 3)], 1); A.tone('triangle', f, f, 0.1, 0.16); },
    parry() { const A = syn(); if (!A || !A.ctx) return; const t = A.ctx.currentTime; A.bell(A.degF(5, 1), 0.3, 0.12, t); A.tone('square', 2400, 1800, 0.05, 0.08); A.noise(0.05, 0.12, 'highpass', 3000); },
    cut() { const A = syn(); if (!A) return; A.noise(0.05, 0.1, 'highpass', 2600); A.tone('square', 1800, 1200, 0.03, 0.06); },
    pop() { const A = syn(); if (!A) return; A.noise(0.18, 0.2, 'highpass', 1500); A.tone('sine', 900, 180, 0.25, 0.14); },
    ring() { const A = syn(); if (!A) return; const f = A.degF(5, 1); A.tone('sine', f, f * 1.5, 0.12, 0.1); },
    clutch() { const A = syn(); if (!A) return; const f = A.degF(3, 1); A.tone('triangle', f, f, 0.07, 0.08); },
    flow(lvl) { const A = syn(); if (!A || !A.ctx) return; const t = A.ctx.currentTime; for (let i = 0; i < 3; i++) { const f = A.degF(1 + i * 2 + Math.min(lvl, 4), 1); A.tone('triangle', f, f, 0.07, 0.09, undefined, t + i * 0.05); } },
    sputter() { const A = syn(); if (!A || !A.ctx) return; const t = A.ctx.currentTime; for (let i = 0; i < 3; i++) A.noise(0.04, 0.08, 'lowpass', 500, undefined, undefined, t + i * 0.09); },
  };
  // Thrust is one looping noise voice for the whole burn (not a node per frame),
  // opened on ignition and released on cut-off; render() also releases it
  // whenever the run isn't stepping (pause, death card) so it can never drone.
  function startJetSound() {
    const A = syn(); if (!A || !A.ctx || S.jetSnd || G.mode !== 'play') return;
    try {
      const ac = A.ctx, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
      src.buffer = A.noiseBuf; src.loop = true;
      f.type = 'bandpass'; f.frequency.value = 480; f.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, t); g.gain.setTargetAtTime(0.11, t, 0.03);
      src.connect(f); f.connect(g); g.connect(A.out); src.start(t);
      S.jetSnd = { src, f, g };
    } catch (e) { S.jetSnd = null; }
  }
  function jetSoundLevel(k) {
    const A = syn(); if (!A || !A.ctx || !S.jetSnd) return;
    S.jetSnd.f.frequency.setTargetAtTime(420 + k * 380, A.ctx.currentTime, 0.06);
  }
  function stopJetSound() {
    const s = S.jetSnd; if (!s) return;
    S.jetSnd = null;
    try { const t = s.g.context.currentTime; s.g.gain.setTargetAtTime(0.0001, t, 0.04); s.src.stop(t + 0.25); } catch (e) {}
  }

  /* ---- drawing (world space: drawWorld / drawBack / drawFront) ---- */
  const glows = {};
  function glowOf(type) { return glows[type] || (glows[type] = glowSprite(26, 'rgba(' + INFO[type].rgb + ',.55)', 0.2)); }
  function drawIcon(type, s) {   // centred at 0,0, ~16px
    const I = INFO[type];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (type === 'jet') {
      ctx.fillStyle = '#F4F7FF'; roundRect(-5.5 * s, -6 * s, 4.5 * s, 10 * s, 2 * s); ctx.fill(); roundRect(1 * s, -6 * s, 4.5 * s, 10 * s, 2 * s); ctx.fill();
      ctx.fillStyle = I.color; ctx.beginPath(); ctx.moveTo(-5 * s, 5 * s); ctx.lineTo(-3.25 * s, 9 * s); ctx.lineTo(-1.5 * s, 5 * s); ctx.moveTo(1.5 * s, 5 * s); ctx.lineTo(3.25 * s, 9 * s); ctx.lineTo(5 * s, 5 * s); ctx.fill();
    } else if (type === 'saber') {
      ctx.strokeStyle = I.color; ctx.lineWidth = 3.2 * s; ctx.beginPath(); ctx.moveTo(-5 * s, 5 * s); ctx.lineTo(6 * s, -7 * s); ctx.stroke();
      ctx.strokeStyle = '#F4F7FF'; ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.moveTo(-4 * s, 4 * s); ctx.lineTo(6 * s, -7 * s); ctx.stroke();
      ctx.strokeStyle = '#8FA2C8'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(-8 * s, 8.5 * s); ctx.lineTo(-5 * s, 5 * s); ctx.stroke();
    } else if (type === 'shield') {
      ctx.strokeStyle = I.color; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(0, 0, 7 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(' + I.rgb + ',.3)'; ctx.fill();
      ctx.strokeStyle = '#F4F7FF'; ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.arc(0, 0, 4.5 * s, -2.6, -1.6); ctx.stroke();
    } else {
      ctx.strokeStyle = I.color; ctx.lineWidth = 3.4 * s; ctx.beginPath(); ctx.arc(0, -1 * s, 5 * s, Math.PI, 0); ctx.lineTo(5 * s, 5 * s); ctx.moveTo(-5 * s, -1 * s); ctx.lineTo(-5 * s, 5 * s); ctx.stroke();
      ctx.strokeStyle = '#F4F7FF'; ctx.lineWidth = 3.4 * s; ctx.beginPath(); ctx.moveTo(-5 * s, 4 * s); ctx.lineTo(-5 * s, 6.5 * s); ctx.moveTo(5 * s, 4 * s); ctx.lineTo(5 * s, 6.5 * s); ctx.stroke();
    }
  }
  function onStage() { return S.player === G.player && G.player && (G.mode === 'play' || G.mode === 'pause' || G.mode === 'resume' || G.mode === 'dead'); }
  function drawWorld(camX) {
    if (!onStage()) return;
    const t = G.time;
    for (const it of S.items) {
      if (it.x < camX - 60 || it.x > camX + view.w + 60) continue;
      const I = INFO[it.type], by = it.y + Math.sin(it.bob) * 3;
      if (it.taken) {   // a quick expanding ghost of the capsule, then gone
        if (it.t > 14) continue;
        ctx.globalAlpha = 1 - it.t / 14; ctx.strokeStyle = I.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(it.x, by, 13 + it.t * 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        continue;
      }
      ctx.drawImage(glowOf(it.type), it.x - 26, by - 26, 52, 52);
      ctx.save(); ctx.translate(it.x, by);
      // capsule: a soft rounded hex with a rim that turns slowly
      ctx.fillStyle = 'rgba(10,14,32,.82)'; ctx.strokeStyle = I.color; ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; const xx = Math.cos(a) * 12, yy = Math.sin(a) * 12; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      drawIcon(it.type, 0.85);
      ctx.fillStyle = I.color;
      for (let i = 0; i < 3; i++) { const a = t * 2.4 + i * 2.094; ctx.fillRect(Math.cos(a) * 17 - 1, Math.sin(a) * 6 - 1, 2, 2); }
      ctx.restore();
    }
    {
      for (const rg of S.rings) {
        if (rg.x < camX - 40 || rg.x > camX + view.w + 40) continue;
        if (S.jet <= 0 && !rg.taken) continue;
        if (rg.taken && rg.t > 16) continue;
        const a = rg.taken ? 1 - rg.t / 16 : 0.55 + 0.35 * Math.sin(t * 4 + rg.x);
        const sc = rg.taken ? 1 + rg.t / 10 : 1;
        ctx.globalAlpha = a; ctx.strokeStyle = INFO.jet.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y, 7 * sc, 20 * sc, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#FFE0C0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y, 7 * sc, 20 * sc, 0, -1.2, 0.2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    for (const r of S.refl) {
      if (!r.live) continue;
      ctx.strokeStyle = INFO.saber.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r.x - r.vx * 1.6, r.y - r.vy * 1.6); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.fillStyle = '#F4F7FF'; ctx.beginPath(); ctx.arc(r.x, r.y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of S.cuts) {
      if (c.t <= 0) continue;
      const k = c.t / 10, L = 26 * (1.2 - k * 0.4);
      ctx.globalAlpha = k; ctx.strokeStyle = '#F4F7FF'; ctx.lineWidth = 2.5 * k + 0.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c.x - Math.cos(c.a) * L, c.y - Math.sin(c.a) * L); ctx.lineTo(c.x + Math.cos(c.a) * L, c.y + Math.sin(c.a) * L); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function drawBack(alpha) {
    if (!onStage()) { if (S.jetSnd) stopJetSound(); return; }
    if (S.jetSnd && G.mode !== 'play') stopJetSound();
    const p = G.player;
    if (p.dead) return;
    const x = lerp(p.px, p.x, alpha) + p.w / 2, y = lerp(p.py, p.y, alpha) + p.h / 2 + p.landDip;
    if (S.jet > 0) {
      const blink = S.jet < TUNE.warn && ((S.jet / 6) | 0) % 2 === 0;
      ctx.save(); ctx.translate(x, y); ctx.scale(p.facing, 1);
      if (S.thrust) {   // twin cones, flickered from the private stream (no rng)
        ctx.globalCompositeOperation = 'lighter';
        const L = 15 + ((G.frameCount * 7919) % 11);   // frame-keyed flicker: render never touches a stream
        for (let i = 0; i < 2; i++) {
          const nx = -15 + i * 5.5;
          ctx.fillStyle = 'rgba(255,120,50,.7)';
          ctx.beginPath(); ctx.moveTo(nx - 3.4, 11); ctx.quadraticCurveTo(nx - 1.5, 11 + L * 0.7, nx, 11 + L); ctx.quadraticCurveTo(nx + 1.5, 11 + L * 0.7, nx + 3.4, 11); ctx.fill();
          ctx.fillStyle = 'rgba(255,236,170,.95)';
          ctx.beginPath(); ctx.moveTo(nx - 1.6, 11); ctx.lineTo(nx, 11 + L * 0.55); ctx.lineTo(nx + 1.6, 11); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = blink ? '#FFE0C0' : '#FF9F4A';
      roundRect(-18.5, -8, 6, 18, 2.8); ctx.fill(); roundRect(-13, -8, 6, 18, 2.8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-17.3, -6, 1.4, 12); ctx.fillRect(-11.8, -6, 1.4, 12);
      ctx.fillStyle = '#5A3A2A'; ctx.fillRect(-18, 9, 10.5, 2.4);
      ctx.restore();
    }
    // Shield i-frames: drawPlayer inherits globalAlpha, so a blink is one set here
    // (drawFront always restores it).
    if (S.invul > 0 && ((S.invul / 4) | 0) % 2 === 0) ctx.globalAlpha = 0.4;
  }
  function drawFront(alpha) {
    ctx.globalAlpha = 1;
    if (!onStage()) return;
    const p = G.player;
    if (p.dead) return;
    const x = lerp(p.px, p.x, alpha) + p.w / 2, y = lerp(p.py, p.y, alpha) + p.h / 2 + p.landDip, t = G.time;
    if (S.shield > 0) {
      const blink = S.shield < TUNE.warn && ((S.shield / 6) | 0) % 2 === 0;
      if (!blink) {
        const I = INFO.shield;
        ctx.fillStyle = 'rgba(' + I.rgb + ',.10)'; ctx.strokeStyle = 'rgba(' + I.rgb + ',.75)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(x, y - 1, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(244,247,255,.7)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y - 1, 21, t * 1.6, t * 1.6 + 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - 1, 21, t * 1.6 + Math.PI, t * 1.6 + Math.PI + 0.5); ctx.stroke();
      }
    }
    if (S.magnet > 0) {   // faint tethers to what it is reeling in
      const blink = S.magnet < TUNE.warn && ((S.magnet / 6) | 0) % 2 === 0;
      ctx.strokeStyle = 'rgba(255,107,138,' + (blink ? 0.15 : 0.35) + ')'; ctx.lineWidth = 1;
      const R = TUNE.magnet.reach;
      ctx.beginPath();
      for (const it of G.pickups) {
        if (it.grabbed) continue;
        const dx = it.x - x, dy = it.y - y;
        if (dx * dx + dy * dy < R * R) { ctx.moveTo(x, y); ctx.lineTo(it.x, it.y); }
      }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 18 + (t * 30) % 14, 0, Math.PI * 2); ctx.stroke();
    }
    if (S.saber > 0) drawSaber(p, x, y);
  }
  // Blade angles: radians in facing space, 0 = straight ahead, negative = up.
  function drawSaber(p, x, y) {
    const I = INFO.saber, A = TUNE.saber;
    const blink = S.saber < TUNE.warn && ((S.saber / 6) | 0) % 2 === 0;
    const hx = 8, hy = 2;   // near glove, roughly (drawPlayer keeps its own rig)
    let ang = -1.05 + Math.sin(G.time * 3) * 0.05, from = ang, swinging = false;
    if (S.swingT >= 0) {
      const k = easeOutCubic(clamp(S.swingT / A.active, 0, 1));
      const a0 = S.swingDir > 0 ? -2.1 : 1.1, a1 = S.swingDir > 0 ? 1.1 : -2.1;
      from = a0; ang = lerp(a0, a1, k); swinging = S.swingT <= A.active + 2;
    }
    ctx.save(); ctx.translate(x, y); ctx.scale(p.facing, 1);
    if (swinging) {   // the smear: a crescent trailing ~70° behind the blade, fading as the swing ends
      const tail = S.swingDir > 0 ? Math.max(from, ang - 1.2) : Math.min(from, ang + 1.2);
      const lo = Math.min(tail, ang), hi = Math.max(tail, ang), fade = 1 - clamp(S.swingT / (A.active + 2), 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = I.color;
      for (let i = 0; i < 2; i++) {   // two bands: a bright outer rim over a soft body
        ctx.globalAlpha = (i ? 0.45 : 0.18) * fade + 0.05;
        const r0 = i ? A.reach - 8 : 18;
        ctx.beginPath(); ctx.arc(hx * 0.5, hy, A.reach, lo, hi); ctx.arc(hx * 0.5, hy, r0, hi, lo, true); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    const L = 34, ex = hx + Math.cos(ang) * L, ey = hy + Math.sin(ang) * L;
    const bx = hx + Math.cos(ang) * 4, by = hy + Math.sin(ang) * 4;
    ctx.lineCap = 'round';
    if (!blink) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + I.rgb + ',.35)'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = I.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#F4F7FF'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.strokeStyle = '#8FA2C8'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(hx - Math.cos(ang) * 3, hy - Math.sin(ang) * 3); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
  }
  // drawPistol() asks: the saber takes the pistol's place in the glove.
  function hidesPistol() { return S.saber > 0 && S.player === G.player && G.player && !G.player.dead; }

  /* ---- HUD (logical px, drawHUD's space) ---- */
  function drawHUD(us, top, left) {
    if (!onStage() || G.player.dead) return;
    const w = 74 * us, h = 13 * us, gap = 4 * us, x = view.w - left - w;
    let y = top + 50 * us;
    for (const type of TYPES) {
      const life = S[type];
      if (life <= 0) continue;
      const I = INFO[type], T = TUNE[type], warn = life < TUNE.warn;
      ctx.save();
      if (warn && ((life / 6) | 0) % 2 === 0) ctx.globalAlpha *= 0.45;
      ctx.fillStyle = 'rgba(10,14,32,.62)'; roundRect(x, y, w, h, 5 * us); ctx.fill();
      ctx.save(); ctx.translate(x + 8 * us, y + h / 2); drawIcon(type, 0.55 * us); ctx.restore();
      const bx = x + 17 * us, bw = w - 22 * us, bh = 4 * us, byy = y + h / 2 - bh / 2;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(bx, byy, bw, bh, 2); ctx.fill();
      const main = type === 'jet' ? S.fuel : life / T.life;
      ctx.fillStyle = type === 'jet' && S.fuel < 0.2 ? '#FF6B6B' : I.color;
      if (main > 0.01) { roundRect(bx, byy, bw * main, bh, 2); ctx.fill(); }
      if (type === 'jet') {   // the pack's own burn-out clock, a hairline under the fuel
        ctx.fillStyle = 'rgba(255,224,192,.7)'; ctx.fillRect(bx, byy + bh + 1.5 * us, bw * life / T.life, Math.max(1, us));
      }
      ctx.restore();
      y += h + gap;
    }
    // Headline slot: pickup names, streaks, milestones. One at a time, newest wins,
    // placed under the chain readout and clear of the celebration banner.
    const H = S.head;
    if (H.t > 0 && !G.deathCardShown) {
      const a = Math.min(1, (H.max - H.t) * 6, H.t * 2.5);
      const yy = view.h * (G.celebrate > 0 ? 0.44 : 0.3) - (H.max - H.t < 0.15 && !lessMotion() ? (0.15 - (H.max - H.t)) * 40 : 0);
      ctx.save(); ctx.globalAlpha *= a; ctx.textAlign = 'center';
      drawGlowText(H.text, view.w / 2, yy, Math.max(16, 20 * us), H.color, '#F4F7FF');
      if (H.sub) {
        ctx.font = fontStr(700, Math.max(9.5, 9.5 * us), FONT); ctx.fillStyle = '#CFE3FF';
        ctx.fillText(H.sub, view.w / 2, yy + 15 * us);
      }
      ctx.restore();
    }
  }
  /* ---- touch (CSS px, drawTouchControls' space) ---- */
  // FIRE becomes SABER while the blade is lit: same button, same thumb.
  function drawFireButton(sx, sy, r) {
    if (!(S.saber > 0 && onStage())) return false;
    const I = INFO.saber, pressed = input.shootBtn.pressed || S.swingT >= 0;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = pressed ? 'rgba(108,242,255,0.34)' : 'rgba(108,242,255,0.16)'; ctx.fill();
    ctx.strokeStyle = 'rgba(108,242,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    const k = S.saber / TUNE.saber.life;
    ctx.strokeStyle = S.saber < TUNE.warn ? '#FF6B6B' : I.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx, sy, r + 8, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(sx, sy - 6); drawIcon('saber', 1); ctx.restore();
    ctx.fillStyle = I.color; ctx.font = '900 11px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('SABER', sx, sy + 15);
    return true;
  }
  // Jump zone: a fuel arc around the jump affordance while the pack is on.
  function drawJumpRing(jx, jy) {
    if (!(S.jet > 0 && onStage())) return;
    ctx.globalAlpha = 0.9; ctx.lineCap = 'round'; ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.arc(jx, jy, 32, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = S.fuel < 0.2 ? '#FF6B6B' : INFO.jet.color;
    ctx.beginPath(); ctx.arc(jx, jy, 32, -Math.PI / 2, -Math.PI / 2 + S.fuel * Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function deathStats() {
    const bits = [];
    if (S.picked) bits.push('POWER-UPS ' + S.picked);
    if (S.parries) bits.push('PARRIES ' + S.parries);
    return bits.length ? ' · ' + bits.join(' · ') : '';
  }

  window.SpaceManPowerups = {
    TYPES, INFO, TUNE, state: S,
    placeFor, ringFor, chunkOf, mix,
    update, jet, fire, combat, guard, slashKill, grant, hidesPistol,
    drawWorld, drawBack, drawFront, drawHUD, drawFireButton, drawJumpRing, deathStats,
  };
})();
