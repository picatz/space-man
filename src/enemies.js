/* New alien roster (world gen 2). Behavior here is a PURE function of a clock
   `c` in 60 Hz steps — the shared round clock in a room (so every screen puts
   every alien in the same place; docs/wire-protocol.md §10.8.1), or the alien's
   own age solo. Nothing here draws from any rng or allocates per frame; the
   only per-screen state is a turret's aim, which only steers that screen's own
   shots (shots only ever hit their own player).

   Every type telegraphs before it acts and has a clean counter:
     diver   hovers, flashes and previews its path, then swoops through it.
             Counter: time the leap, stomp it at the bottom, or shoot it.
     shield  a walker behind an energy shield: shots from the front bounce off.
             Counter: stomp it, or shoot it in the back after it turns.
     brute   big, slow, three shots to drop. Raises its fists, then slams a
             shockwave along its slab. Counter: jump the wave, or stomp it.
     bomber  a saucer that paces a stretch and drops bombs; a reticle marks
             the landing spot first. Counter: keep moving, or shoot it down.
     turret  a sentinel that turns slowly toward you and paints a laser before
             it fires along it. Counter: change pace, or stomp it (two shots). */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const EV = { TEL: 1, FIRE: 2, SWOOP: 4, SLAM: 8 };
  const TYPES = ['diver', 'shield', 'brute', 'bomber', 'turret'];
  // Timings in steps. Kept here so the generator, sim, docs and tests agree.
  const DIVER = { tel: 40, swoop: 64 };
  const BRUTE = { tel: 42, rec: 30, wave: 4.2, waveH: 14 };
  const BOMBER = { tel: 30 };
  const TURRET = { tel: 40, turn: 0.03, range: 560 };
  const HP = { brute: 3, turret: 2 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Ping-pong along [minX, maxX] from spawn x0 heading dir0, after walking d px —
  // the same unfolded-lap formula as the original patrol (§10.8.1).
  function laneTo(e, d) {
    const L = e.maxX - e.minX;
    if (!(L > 0)) { e.x = e.minX; return; }
    const off = clamp(e.x0 - e.minX, 0, L), q0 = e.dir0 > 0 ? off : 2 * L - off;
    let q = (q0 + d) % (2 * L); if (q < 0) q += 2 * L;
    e.x = e.minX + (q <= L ? q : 2 * L - q);
    e.dir = q < L ? 1 : -1;
  }
  // Events at f0 + k·per; telegraph for the last `tel` steps before each. On
  // first sight (ev < 0) the count is adopted without firing — a late arrival
  // never sees a burst of missed shots.
  function schedule(e, c, tel) {
    const n = c >= e.f0 ? Math.floor((c - e.f0) / e.per) + 1 : 0;
    const rem = e.f0 + n * e.per - c;
    let ev = 0;
    const t = rem <= tel ? rem / 60 : 0;
    if (t > 0 && !(e.telegraph > 0)) ev |= EV.TEL;
    e.telegraph = t;
    if (e.ev < 0) e.ev = n;
    else if (n > e.ev) { e.ev = n; ev |= EV.FIRE; }
    return ev;
  }

  // Advance alien `e` to clock T (steps). tx/ty: this screen's player centre
  // (only a turret's aim reads it). Returns an EV bitmask for the sim's effects.
  function step(e, T, tx, ty) {
    const c = T + e.ph;
    let ev = 0;
    if (e.hurt > 0) e.hurt--;
    switch (e.type) {
      case 'diver': {
        const C = e.per, hov = C - DIVER.tel - DIVER.swoop;
        const k = Math.floor(c / C), u = c - k * C, fwd = (k & 1) === 0;
        const A = fwd ? e.hx : e.hx + e.span, B = fwd ? e.hx + e.span : e.hx;
        const bob = Math.sin(c * 0.07) * 4;
        const prev = e.state;
        e.dir = B > A ? 1 : -1; e.ax = A; e.bx = B;
        if (u < hov + DIVER.tel) {
          e.x = A; e.y = e.hy + bob;
          e.state = u >= hov ? 1 : 0;
          e.telegraph = e.state ? (hov + DIVER.tel - u) / 60 : 0;
          if (e.state === 1 && prev === 0) ev |= EV.TEL;
          e.s = 0;
        } else {
          const s = (u - hov - DIVER.tel) / DIVER.swoop;
          e.x = A + (B - A) * (s * s * (3 - 2 * s));
          e.y = e.hy + bob + e.depth * Math.sin(Math.PI * s);
          e.state = 2; e.telegraph = 0; e.s = s;
          if (prev !== 2 && prev !== undefined && prev !== -1) ev |= EV.SWOOP;
        }
        e.flap = c * (e.state === 1 ? 0.55 : e.state === 2 ? 0.12 : 0.28);
        break;
      }
      case 'shield':
        laneTo(e, e.speed * c);
        e.walkPhase = c * 0.14;
        break;
      case 'brute': {
        const P = e.per, walk = P - BRUTE.tel - BRUTE.rec, slamAt = walk + BRUTE.tel;
        const k = Math.floor(c / P), u = c - k * P;
        laneTo(e, e.speed * (k * walk + Math.min(u, walk)));
        e.walkPhase = (k * walk + Math.min(u, walk)) * 0.1;
        e.telegraph = u >= walk && u < slamAt ? (slamAt - u) / 60 : 0;
        if (e.telegraph > 0 && !(e.telWas > 0)) ev |= EV.TEL;
        e.telWas = e.telegraph;
        // Slams so far, and how long since the latest one (its wave).
        const n = k + (u >= slamAt ? 1 : 0);
        const since = u >= slamAt ? u - slamAt : (k > 0 ? u + P - slamAt : -1);
        if (e.ev < 0) e.ev = n; else if (n > e.ev) { e.ev = n; ev |= EV.SLAM; }
        e.slamT = since;
        // The wave leaves from where the brute stood when it slammed.
        if (since >= 0) {
          const kk = u >= slamAt ? k : k - 1, save = e.x, sd = e.dir;
          laneTo(e, e.speed * (kk + 1) * walk); e.waveX = e.x; e.x = save; e.dir = sd;
          const d = since * BRUTE.wave;
          e.waveL = e.waveX - d >= e.platX0 ? e.waveX - d : NaN;
          e.waveR = e.waveX + d <= e.platX1 ? e.waveX + d : NaN;
        } else { e.waveL = NaN; e.waveR = NaN; }
        break;
      }
      case 'bomber':
        laneTo(e, e.speed * c);
        e.y = e.baseY + Math.sin(c * 0.05) * 3;
        ev |= schedule(e, c, BOMBER.tel);
        break;
      case 'turret': {
        ev |= schedule(e, c, TURRET.tel);
        // Aim: turn toward this screen's player at a capped rate (local only).
        const want = Math.atan2(ty - e.y, tx - e.x);
        let d = want - e.aim;
        while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        e.aim += clamp(d, -TURRET.turn, TURRET.turn);
        break;
      }
    }
    return ev;
  }
  // A player shot that reaches `e` (bullet vx): 'kill', 'block' (bounced off a
  // shield front) or 'hurt' (armor soaked it; hp left).
  function shotResult(e, vx) {
    if (e.type === 'shield' && vx * e.dir < 0) return 'block';
    if (e.hp > 1) { e.hp--; e.hurt = 10; return 'hurt'; }
    return 'kill';
  }
  // Is a grounded player (centre px, feet on slab top py) inside a brute's wave?
  function waveHits(e, px, feetY) {
    if (e.type !== 'brute' || !(e.slamT >= 0)) return false;
    if (Math.abs(feetY - e.platY) > 3 || px < e.platX0 - 4 || px > e.platX1 + 4) return false;
    return Math.abs(px - e.waveL) < 9 || Math.abs(px - e.waveR) < 9;
  }

  /* ---- Art: canvas primitives only, in the house style (soft glow sprite, a
     rounded body, white eyes that track the player, a readable telegraph). ---- */
  const DASH = [3, 5], NODASH = [];
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function eyes(ctx, e, sep, y, r, pupil, angry) {
    const lx = (e.lookX || 0) * 2, ly = (e.lookY || 0) * 1.5;
    for (let i = -1; i <= 1; i += 2) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(i * sep, y, r, r * 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = angry ? '#C8102E' : '#0a1428';
      ctx.beginPath(); ctx.arc(i * sep + lx, y + ly, pupil, 0, TAU); ctx.fill();
    }
  }
  const blink = (t) => Math.floor(t * 20) % 2 === 1;

  // World-space telegraph overlays, drawn before the body. platY(x) → slab top or NaN.
  function drawFx(ctx, e, t, platY) {
    if (e.dead) return;
    if (e.type === 'diver' && e.state === 1) {
      // Dotted preview of the swoop it is about to take.
      const a = 0.35 + 0.35 * (1 - e.telegraph / (DIVER.tel / 60));
      ctx.fillStyle = 'rgba(255,120,200,' + a.toFixed(3) + ')';
      for (let i = 1; i < 12; i++) {
        const s = i / 12, x = e.ax + (e.bx - e.ax) * (s * s * (3 - 2 * s)), y = e.hy + e.depth * Math.sin(Math.PI * s);
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
      }
    } else if (e.type === 'bomber' && e.telegraph > 0) {
      const gy = platY(e.x, e.y);
      if (gy === gy) {
        const k = 1 - e.telegraph / (BOMBER.tel / 60), r = 14 - 6 * k;
        ctx.strokeStyle = blink(t) ? 'rgba(255,79,102,.95)' : 'rgba(255,79,102,.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(e.x, gy - 2, r, r * 0.35, 0, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(e.x - r - 4, gy - 2); ctx.lineTo(e.x - r + 3, gy - 2); ctx.moveTo(e.x + r - 3, gy - 2); ctx.lineTo(e.x + r + 4, gy - 2); ctx.stroke();
        ctx.setLineDash(DASH); ctx.strokeStyle = 'rgba(255,79,102,.3)';
        ctx.beginPath(); ctx.moveTo(e.x, e.y + 10); ctx.lineTo(e.x, gy - 4); ctx.stroke(); ctx.setLineDash(NODASH);
      }
    } else if (e.type === 'turret' && e.telegraph > 0) {
      const k = 1 - e.telegraph / (TURRET.tel / 60), ca = Math.cos(e.aim), sa = Math.sin(e.aim);
      const x0 = e.x + ca * 14, y0 = e.y - 4 + sa * 14;
      ctx.strokeStyle = 'rgba(255,79,102,' + (0.25 + 0.6 * k).toFixed(3) + ')'; ctx.lineWidth = 1 + k;
      ctx.setLineDash(k > 0.7 ? NODASH : DASH);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + ca * 420, y0 + sa * 420); ctx.stroke();
      ctx.setLineDash(NODASH);
    } else if (e.type === 'brute' && e.slamT >= 0) {
      const life = 1 - clamp(e.slamT / 70, 0, 1);
      for (let i = 0; i < 2; i++) {
        const x = i ? e.waveR : e.waveL;
        if (x !== x) continue;
        ctx.fillStyle = 'rgba(255,201,60,' + (0.45 * life + 0.35).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(x - 10, e.platY); ctx.quadraticCurveTo(x, e.platY - BRUTE.waveH * 2, x + 10, e.platY); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,241,200,.9)';
        ctx.beginPath(); ctx.moveTo(x - 5, e.platY); ctx.quadraticCurveTo(x, e.platY - BRUTE.waveH, x + 5, e.platY); ctx.closePath(); ctx.fill();
      }
    }
  }

  // Body, in alien-local space (origin = hitbox centre; the sim has translated).
  function draw(ctx, e, t, GLOW) {
    const tel = e.telegraph > 0, flash = tel && blink(t);
    switch (e.type) {
      case 'diver': {
        ctx.drawImage(GLOW.coral, -26, -26, 52, 52);
        const f = Math.sin(e.flap || 0), spread = e.state === 2 ? 0.2 : 1;
        ctx.fillStyle = flash ? '#FFD1F0' : '#C77DFF';
        for (let i = -1; i <= 1; i += 2) {   // wings
          ctx.beginPath(); ctx.moveTo(i * 6, -2);
          ctx.quadraticCurveTo(i * 20, -14 - f * 8 * spread, i * 26, -2 + f * 6 * spread);
          ctx.quadraticCurveTo(i * 17, 2, i * 6, 5); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = flash ? '#FFE6F7' : '#9D4EDD';
        ctx.beginPath(); ctx.ellipse(0, 0, 10, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#FF9E3D';   // beak points along the swoop
        ctx.beginPath(); ctx.moveTo(e.dir * 7, 2); ctx.lineTo(e.dir * 14, 4); ctx.lineTo(e.dir * 7, 6); ctx.closePath(); ctx.fill();
        eyes(ctx, e, 4, -2, 3, 1.6, tel || e.state === 2);
        if (tel) { ctx.strokeStyle = '#5A189A'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-2, -5); ctx.moveTo(7, -7); ctx.lineTo(2, -5); ctx.stroke(); }
        break;
      }
      case 'shield': {
        ctx.drawImage(GLOW.green, -30, -30, 60, 60);
        const walk = Math.sin(e.walkPhase || 0);
        ctx.fillStyle = '#3FCB6B';
        ctx.beginPath(); ctx.ellipse(0, 0, e.w / 2, e.h / 2 * (1 + walk * 0.06), 0, Math.PI, TAU); ctx.fill();
        rr(ctx, -e.w / 2, -1, e.w, e.h / 2 + 2, 5); ctx.fill();
        ctx.fillStyle = '#2A8C4A'; rr(ctx, -e.w / 2 + 2, -e.h / 2 + 2, e.w - 4, 5, 2.5); ctx.fill();   // helmet band
        eyes(ctx, e, 5, -1, 3.2, 1.7, false);
        ctx.fillStyle = '#1F9E4E';
        ctx.beginPath(); ctx.arc(-5, e.h / 2 - 1 + Math.abs(walk) * 2, 3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(5, e.h / 2 - 1 + Math.abs(walk) * 2, 3, 0, TAU); ctx.fill();
        // The shield: a bright hex plate on the facing side.
        const sx = e.dir * (e.w / 2 + 3), hit = e.hurt > 0;
        ctx.fillStyle = hit ? 'rgba(255,255,255,.95)' : 'rgba(159,241,255,.35)';
        ctx.strokeStyle = hit ? '#FFFFFF' : '#9FF1FF'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, -e.h / 2 - 2); ctx.lineTo(sx + e.dir * 5, -e.h / 4); ctx.lineTo(sx + e.dir * 5, e.h / 4);
        ctx.lineTo(sx, e.h / 2 + 1); ctx.lineTo(sx - e.dir * 2, e.h / 4); ctx.lineTo(sx - e.dir * 2, -e.h / 4); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'brute': {
        ctx.drawImage(GLOW.coral, -40, -40, 80, 80);
        const up = tel ? 1 - e.telegraph / (BRUTE.tel / 60) : 0, shake = tel ? Math.sin(t * 90) * 1.2 : 0;
        const walk = Math.sin(e.walkPhase || 0), hit = e.hurt > 0;
        ctx.translate(shake, 0);
        ctx.fillStyle = hit ? '#FFFFFF' : flash ? '#FFB38A' : '#FF7A45';
        ctx.beginPath(); ctx.ellipse(0, -2, e.w / 2, e.h / 2 + 1, 0, Math.PI, TAU); ctx.fill();
        rr(ctx, -e.w / 2, -3, e.w, e.h / 2 + 3, 7); ctx.fill();
        ctx.fillStyle = '#FFE0C2';   // horns
        for (let i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.moveTo(i * 9, -e.h / 2 + 3); ctx.lineTo(i * 14, -e.h / 2 - 7); ctx.lineTo(i * 15, -e.h / 2 + 5); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = '#C94C1E'; rr(ctx, -9, 4, 18, 6, 3); ctx.fill();      // jaw
        ctx.fillStyle = '#FFF'; ctx.fillRect(-6, 4, 3, 3); ctx.fillRect(3, 4, 3, 3);
        eyes(ctx, e, 6, -6, 3, 1.6, tel);
        ctx.strokeStyle = '#8C2F0E'; ctx.lineWidth = 2;                         // brow
        ctx.beginPath(); ctx.moveTo(-10, -11); ctx.lineTo(-3, -8); ctx.moveTo(10, -11); ctx.lineTo(3, -8); ctx.stroke();
        ctx.fillStyle = hit ? '#FFFFFF' : '#E85D2A';                            // fists
        for (let i = -1; i <= 1; i += 2) {
          const fx = i * (e.w / 2 + 3), fy = lerpN(6 + Math.abs(walk) * 2, -e.h / 2 - 8, up);
          ctx.beginPath(); ctx.arc(fx, fy, 6.5, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#B8461C';
        ctx.beginPath(); ctx.arc(-8, e.h / 2 - 1, 4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(8, e.h / 2 - 1, 4, 0, TAU); ctx.fill();
        if (e.hp > 1 && !e.dead) {                                             // armor pips
          ctx.fillStyle = '#FFE59A';
          for (let i = 0; i < e.hp; i++) { ctx.beginPath(); ctx.arc(-4 * (e.hp - 1) + i * 8, -e.h / 2 - 10, 2, 0, TAU); ctx.fill(); }
        }
        break;
      }
      case 'bomber': {
        ctx.drawImage(GLOW.cyan, -32, -28, 64, 56);
        ctx.fillStyle = 'rgba(159,241,255,.55)';                                 // dome
        ctx.beginPath(); ctx.ellipse(0, -4, 8, 8, 0, Math.PI, TAU); ctx.fill();
        ctx.fillStyle = '#4EF07A'; ctx.beginPath(); ctx.arc(0, -6, 4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc((e.lookX || 0) * 1.2, -7, 1.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8A93B8'; ctx.beginPath(); ctx.ellipse(0, 0, e.w / 2, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5E6788'; ctx.beginPath(); ctx.ellipse(0, 2, e.w / 2 - 4, 3, 0, 0, Math.PI); ctx.fill();
        for (let i = -1; i <= 1; i++) {                                        // running lights
          ctx.fillStyle = Math.floor(t * 6 + i) % 3 === 0 ? '#FFC93C' : '#FFF1A8';
          ctx.beginPath(); ctx.arc(i * 9, 0.5, 1.5, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = tel ? (flash ? '#FFFFFF' : '#FF4F66') : '#2A2F45';        // bomb bay
        ctx.beginPath(); ctx.ellipse(0, 5, 4, 2, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'turret': {
        ctx.drawImage(GLOW.coral, -26, -26, 52, 52);
        ctx.fillStyle = '#5E6788'; rr(ctx, -e.w / 2, 2, e.w, e.h / 2 - 2, 3); ctx.fill();       // base
        ctx.save(); ctx.translate(0, -4); ctx.rotate(e.aim);
        ctx.fillStyle = tel ? '#FFB0BC' : '#AEB7D6'; rr(ctx, 2, -2.5, 15, 5, 2); ctx.fill();   // barrel
        ctx.restore();
        ctx.fillStyle = e.hurt > 0 ? '#FFFFFF' : '#8A93B8';
        ctx.beginPath(); ctx.arc(0, -2, 10, Math.PI, TAU); ctx.lineTo(10, 3); ctx.lineTo(-10, 3); ctx.closePath(); ctx.fill();
        const ex = Math.cos(e.aim) * 3, ey = Math.sin(e.aim) * 2;
        ctx.fillStyle = '#0a1428'; ctx.beginPath(); ctx.arc(ex, -4 + ey, 4.5, 0, TAU); ctx.fill();
        ctx.fillStyle = tel ? (flash ? '#FFFFFF' : '#FF4F66') : '#FF8090';
        ctx.beginPath(); ctx.arc(ex, -4 + ey, 2.6, 0, TAU); ctx.fill();
        if (e.hp > 1 && !e.dead) { ctx.fillStyle = '#FFE59A'; ctx.beginPath(); ctx.arc(-3, -15, 1.8, 0, TAU); ctx.arc(3, -15, 1.8, 0, TAU); ctx.fill(); }
        break;
      }
    }
  }
  const lerpN = (a, b, k) => a + (b - a) * k;
  // Bombs: dark shell, blinking fuse (drawn by the sim's enemy-shot pass).
  function drawBomb(ctx, x, y, t) {
    ctx.fillStyle = '#2A2F45'; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8A93B8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
    ctx.fillStyle = blink(t) ? '#FF4F66' : '#FFC93C'; ctx.beginPath(); ctx.arc(x, y - 6, 1.8, 0, TAU); ctx.fill();
  }
  const NAMES = { diver: 'DIVER', shield: 'SHIELDER', brute: 'BRUTE', bomber: 'BOMBER', turret: 'SENTINEL' };
  const TIPS = {
    diver: 'DIVER — it flashes, then swoops the dotted path. Time your leap.',
    shield: 'SHIELDER — shots bounce off the shield. Stomp it, or hit its back.',
    brute: 'BRUTE — three shots or one stomp. Jump its shockwave.',
    bomber: 'BOMBER — a red ring marks each bomb. Keep moving.',
    turret: 'SENTINEL — it paints a laser, then fires. Change your pace.',
  };
  window.SpaceManEnemies = { EV, TYPES, DIVER, BRUTE, BOMBER, TURRET, HP, NAMES, TIPS, laneTo, step, shotResult, waveHits, draw, drawFx, drawBomb };
})();
