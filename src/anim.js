/* Character animation rig — presentation only.
   Pure state machines and pose solvers the renderer reads; nothing here touches
   the simulation, the worldgen rng, the DOM or the canvas. A rig is stepped once
   per fixed sim tick from a READ of the player (so hitstop freezes it for free
   and #shot frames stay deterministic), and every pose function writes into a
   caller-owned Float32Array: zero per-frame allocation. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Deterministic 0..1 hash (no Math.random: the same run blinks the same way).
  const hash01 = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  // Damped spring, semi-implicit Euler. k = stiffness, d = damping (per second).
  function spring(s, target, k, d, dt) {
    s.v += ((target - s.x) * k - s.v * d) * dt;
    s.x += s.v * dt;
    return s.x;
  }

  const TAIL = 12;   // comet trail samples (ring buffer)

  function createRig() {
    return {
      t: 0,
      // blink: seconds of lid-closed remaining; blinkIn: seconds until the next one
      blink: 0, blinkIn: 1.6, blinkN: 1,
      crouch: { x: 0, v: 0 },   // landing knee compression, 0 = standing, ~1 = deep crouch
      launch: 0,                // 1 → 0 over ~0.2 s after leaving the ground (legs extend + trail)
      stomp: 0,                 // 1 → 0 over ~0.3 s after a stomp (tuck + stretch pop + happy eyes)
      hurt: 0,                  // 1 → 0 over ~0.35 s from the fatal hit (flash + wide eyes)
      happy: 0,                 // eye mood: ^^ while > 0
      wasGround: true, wasDead: false, kills: 0, prevVy: 0,
      // comet companion
      tailX: new Float32Array(TAIL), tailY: new Float32Array(TAIL), tailHead: 0, tailFill: 0,
      comet: { vx: 0, vy: 0, squash: 0, look: 0, happy: 0 },
      events: { land: 0, jump: 0, stomp: 0, hurt: 0 },   // counters (tests + hooks)
    };
  }

  // s: { onGround, vx, vy, dead, kills, hang, idle } — a read of the sim.
  function stepRig(r, s, dt, calm) {
    r.t += dt;
    // events (edge-detected so no sim hook is needed)
    if (s.dead && !r.wasDead) { r.hurt = 1; r.events.hurt++; }
    if (!s.dead) {
      if (s.onGround && !r.wasGround && !s.hang) {
        const impact = clamp(r.prevVy / 14, 0, 1);
        r.crouch.v += (calm ? 14 : 26) * (0.35 + impact);
        r.events.land++;
      }
      if (!s.onGround && r.wasGround && s.vy < -4) { r.launch = 1; r.events.jump++; }
      if (s.kills > r.kills && s.vy < -6) { r.stomp = 1; r.happy = Math.max(r.happy, 0.6); r.events.stomp++; }
    }
    r.kills = s.kills; r.wasGround = s.onGround; r.wasDead = s.dead; r.prevVy = s.vy;
    spring(r.crouch, 0, 260, 22, dt);
    if (r.crouch.x < 0) r.crouch.x *= 0.5;   // never "hop" above standing height
    if (r.crouch.x > 1.2) { r.crouch.x = 1.2; r.crouch.v = 0; }
    r.launch = Math.max(0, r.launch - dt / 0.2);
    r.stomp = Math.max(0, r.stomp - dt / 0.3);
    r.hurt = Math.max(0, r.hurt - dt / 0.35);
    r.happy = Math.max(0, r.happy - dt);
    // blink cadence: 2.2–4.8 s apart, 0.13 s closed; a sleepy idle blinks slower
    if (r.blink > 0) r.blink = Math.max(0, r.blink - dt);
    else if ((r.blinkIn -= dt) <= 0) {
      r.blink = 0.13;
      r.blinkIn = 2.2 + hash01(r.blinkN++) * 2.6 + (s.idle > 8 ? 2 : 0);
      if (hash01(r.blinkN * 3.7) < 0.18) r.blinkIn = 0.22;   // the occasional double-blink
    }
    return r;
  }

  // 0 open … 1 closed. Triangle over the blink window.
  function lidAmount(r) {
    if (r.blink <= 0) return 0;
    const k = r.blink / 0.13;
    return 1 - Math.abs(k * 2 - 1);
  }

  // Eye mood for the renderer: 0 neutral, 1 happy (^^), 2 hurt (wide), 3 sleepy
  function eyeMood(r, idle) {
    if (r.hurt > 0) return 2;
    if (r.happy > 0) return 1;
    if (idle > 10) return 3;
    return 0;
  }

  /* Two-bone legs. Local sprite space (x toward facing, y down), hips at
     (hipX, hipY). Writes, per leg (back then front), 6 numbers:
     hipX, hipY, kneeX, kneeY, footX, footY  → out[0..11].
     o: { runCycle, speed (0..1), onGround, pose (-4 rising … 4 falling), hang, hangT,
          crouch, launch, stomp, groundY (foot baseline), hipY, hipX, len (per segment) } */
  function legPose(o, out) {
    const L = o.len, base = o.groundY;
    for (let leg = 0; leg < 2; leg++) {
      const hx = leg === 0 ? o.hipX : -o.hipX, hy = o.hipY;
      let fx, fy;
      if (o.hang) {
        const sw = Math.sin(o.hangT * 6 + leg * 0.9) * 1.6;
        fx = hx + sw * (leg ? 1 : -1) * 0.6; fy = hy + L * 1.9;
      } else if (o.onGround) {
        // Run: the foot traces a flattened loop; planted half hugs the baseline,
        // swing half lifts. Idle: feet planted a little apart.
        const ph = o.runCycle + (leg === 0 ? 0 : Math.PI);
        const stride = 5.5 * o.speed, lift = 4.2 * o.speed;
        fx = hx * 0.7 + Math.sin(ph) * stride;
        fy = base - Math.max(0, Math.cos(ph)) * lift;
        fx += (leg === 0 ? 0.8 : -0.8) * (1 - o.speed);
      } else {
        // Air: rising tucks (knees up), falling reaches down for the landing.
        const fall = clamp(o.pose / 4, -1, 1) * 0.5 + 0.5;   // 0 rising → 1 falling
        const tuck = Math.max(1 - fall, o.stomp) * (1 - o.launch * 0.7);
        const reach = leg === 0 ? -2.5 : 3;                   // front leg reaches ahead
        fx = hx * 0.6 + reach * (0.4 + fall * 0.6) - o.launch * (leg === 0 ? 3 : 1.5);
        fy = base - tuck * 5.5 - (leg === 0 ? 0.6 : 0);
      }
      if (fy > base) fy = base;   // feet never sink below the contact line
      // IK: equal segments, knee bends toward +x (the facing side).
      let dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy) || 0.0001;
      const maxD = L * 2 - 0.001;
      if (d > maxD) { fx = hx + dx / d * maxD; fy = hy + dy / d * maxD; dx = fx - hx; dy = fy - hy; d = maxD; }
      const h = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
      // perpendicular to (dx,dy) pointing to +x side
      let px = -dy / d, py = dx / d;
      if (px < 0) { px = -px; py = -py; }
      const i = leg * 6;
      out[i] = hx; out[i + 1] = hy;
      out[i + 2] = hx + dx / 2 + px * h; out[i + 3] = hy + dy / 2 + py * h;
      out[i + 4] = fx; out[i + 5] = fy;
    }
    return out;
  }

  // Comet companion: feed its sim position each tick; the trail and squash are
  // derived here. Returns the comet render state.
  function stepComet(r, x, y, dt, stompEvent) {
    const c = r.comet, n = TAIL;
    if (r.tailFill === 0) { for (let i = 0; i < n; i++) { r.tailX[i] = x; r.tailY[i] = y; } r.tailFill = n; }
    const prev = (r.tailHead + n - 1) % n;
    const vx = x - r.tailX[prev], vy = y - r.tailY[prev];   // px per sim tick
    c.vx += (vx - c.vx) * 0.3; c.vy += (vy - c.vy) * 0.3;
    r.tailX[r.tailHead] = x; r.tailY[r.tailHead] = y; r.tailHead = (r.tailHead + 1) % n;
    const sp = Math.hypot(c.vx, c.vy);
    c.squash = clamp(sp / 9, 0, 0.35);
    c.look += (clamp(c.vx / 4, -1, 1) - c.look) * 0.2;
    if (stompEvent) c.happy = 0.7;
    c.happy = Math.max(0, c.happy - dt);
    return c;
  }
  // i = 0 newest … TAIL-1 oldest
  function tailPoint(r, i, out) {
    const n = TAIL, k = (r.tailHead - 1 - i + n * 2) % n;
    out[0] = r.tailX[k]; out[1] = r.tailY[k];
    return out;
  }

  root.SpaceManAnim = { createRig, stepRig, legPose, lidAmount, eyeMood, stepComet, tailPoint, spring, hash01, TAIL };
})(typeof window !== 'undefined' ? window : globalThis);
