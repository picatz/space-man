/* ============================================================================
   SPACE MAN — ghost smoothing (Run Together). Classic script; defines
   window.SpaceManSmooth only. Pure math, no timers, no DOM, no rng: the game
   hands it samples and asks for a position at a time, so it runs identically
   in a browser, the node test harness and the bad-network bench.

   One Track per remote runner. Every sample carries the SENDER's own clock
   (its sim-frame counter, 60/s, mod 2^16 on the wire), so arrival jitter,
   relay bursts and reordering never bend the motion itself:

     • a jitter buffer: playout runs `delay` ms behind the sender's clock as
       seen here. The baseline is the fastest recent arrival (window minimum
       of arrival − send time); the delay above it covers the observed spread
       plus one send interval, so a late sample still lands before it's
       needed. The playout clock slews ±6% at most — never a time jump.
     • interpolation between the two samples around the playout time (cubic
       Hermite on the sender's velocities, so a hop keeps its arc).
     • bounded extrapolation when the buffer runs dry (≤ EXTRAP_MS on the last
       velocity, then glide to a stop), never a runaway.
     • error correction: when fresh data disagrees with what was shown, the
       difference is folded into an offset that decays (τ ≈ 90 ms) — no
       teleport, no rubber band. A genuine jump (respawn, new round) snaps.
   ========================================================================== */
(function (root) {
  'use strict';
  const FRAME_MS = 1000 / 60;      // sender clock unit (one sim step)
  const WIN = 48;                  // offsets remembered (~5 s at 10 Hz)
  const MIN_DELAY = 70, MAX_DELAY = 1200;
  const EXTRAP_MS = 220, GLIDE_MS = 250;
  const SNAP_PX = 360;             // farther than this in one step = a real jump: snap, don't glide
  const TAU = 90;                  // ms, error-correction decay
  const SLEW = 0.06;               // playout rate stays within 1 ± SLEW
  const HIST = 16;                 // samples kept (≥1.5 s at 10 Hz)
  const RESYNC_MS = 450;           // playout this far from target = a clock step, not jitter: jump

  function Track() {
    this.reset();
  }
  Track.prototype.reset = function () {
    this.s = [];                   // samples sorted by t (sender ms, unwrapped)
    this.last16 = -1; this.tAcc = 0;
    this.offs = []; this.base = 0;
    this.gap = 100;                // EWMA of send interval (sender ms)
    this.delay = -1;               // current playout offset: now − delay = playout time in sender ms
    this.target = 0;
    this.lastNow = 0; this.shown = null; this.cx = 0; this.cy = 0; this.lastModel = null;
    this.starved = 0; this.extrap = 0; this.pushes = 0;
  };
  // Sender frame counter (u16) → monotonic sender ms. A jump of more than 5 s
  // either way (respawn, new run, a sender that restarted) starts a new trace.
  Track.prototype.unwrap = function (t16) {
    if (this.last16 < 0) { this.last16 = t16; this.tAcc = t16; return this.tAcc * FRAME_MS; }
    const d = ((t16 - this.last16 + 0x8000) & 0xffff) - 0x8000;
    if (d > 300 || d < -300) return null;
    if (d > 0) { this.last16 = t16; this.tAcc += d; return this.tAcc * FRAME_MS; }
    return (this.tAcc + d) * FRAME_MS;          // late (reordered) sample: slot it into the past
  };
  // p = {t16, x, y, vx, vy, ground} (vx/vy in px per sim step); now = local ms at arrival.
  Track.prototype.push = function (p, now) {
    let t = this.unwrap(p.t16 & 0xffff);
    if (t === null) { this.reset(); t = this.unwrap(p.t16 & 0xffff); }   // new trace: next sample() snaps to it
    const s = this.s;
    for (let i = 0; i < s.length; i++) if (s[i].t === t) return false;        // duplicate
    const smp = { t, x: p.x, y: p.y, vx: (p.vx || 0) / FRAME_MS, vy: p.ground ? 0 : (p.vy || 0) / FRAME_MS };
    let i = s.length;
    while (i > 0 && s[i - 1].t > t) i--;
    if (i === 0 && s.length && this.delay >= 0 && t < now - this.delay - 50) return false;   // older than anything still useful
    s.splice(i, 0, smp);
    if (s.length > HIST) s.shift();
    if (i === s.length - 1 && s.length > 1) {
      const g = t - s[s.length - 2].t;
      if (g > 0 && g < 1000) this.gap += (g - this.gap) * 0.15;
    }
    // Offset window: arrival − send. Its minimum is the path's fastest trip;
    // everything above it is queueing/jitter the buffer has to absorb.
    const off = now - t;
    this.offs.push(off); if (this.offs.length > WIN) this.offs.shift();
    // Baseline = a low percentile, not the bare minimum: one sample stamped across a clock
    // step would otherwise pin the whole buffer for the length of the window.
    const sorted = this.offs.slice().sort((a, b) => a - b);
    const lo = sorted[sorted.length >= 8 ? Math.floor(sorted.length * 0.1) : 0];
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    this.base = lo;
    this.target = lo + Math.max(MIN_DELAY, Math.min(MAX_DELAY, (p90 - lo) + this.gap * 1.15 + 16));
    if (this.delay < 0) this.delay = this.target;
    this.pushes++;
    return true;
  };
  function hermite(a, b, t) {
    const dt = b.t - a.t, u = (t - a.t) / dt, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const lx = a.x + (b.x - a.x) * u, ly = a.y + (b.y - a.y) * u;
    let x = h00 * a.x + h10 * dt * a.vx + h01 * b.x + h11 * dt * b.vx;
    let y = h00 * a.y + h10 * dt * a.vy + h01 * b.y + h11 * dt * b.vy;
    // Velocities that disagree with the positions (a landing, a wall, a
    // clamp) would overshoot: fall back toward the straight line.
    const span = Math.max(4, Math.abs(b.x - a.x) * 0.25);
    if (Math.abs(x - lx) > span) x = lx;
    if (Math.abs(y - ly) > Math.max(6, Math.abs(b.y - a.y) * 0.5 + 6)) y = ly;
    return { x, y };
  }
  // Model position at playout time pt (sender ms).
  Track.prototype.model = function (pt) {
    const s = this.s, n = s.length;
    if (!n) return null;
    if (pt <= s[0].t) return { x: s[0].x, y: s[0].y, mode: 0 };
    const last = s[n - 1];
    if (pt >= last.t) {
      const over = pt - last.t;
      const e = Math.min(over, EXTRAP_MS), g = Math.min(Math.max(0, over - EXTRAP_MS), GLIDE_MS);
      // glide: velocity eases to zero over GLIDE_MS (distance = v·g·(1 − g/2G))
      const k = e + g * (1 - g / (2 * GLIDE_MS));
      return { x: last.x + last.vx * k, y: last.y + last.vy * Math.min(k, EXTRAP_MS * 0.5), mode: 2, over };
    }
    let i = n - 1;
    while (i > 0 && s[i - 1].t > pt) i--;
    const r = hermite(s[i - 1], s[i], pt);
    r.mode = 1;
    return r;
  };
  // Position to draw at local time now (ms). Returns null before any sample.
  Track.prototype.sample = function (now) {
    if (!this.s.length) return null;
    const dt = this.lastNow ? Math.max(0, Math.min(100, now - this.lastNow)) : 16;
    this.lastNow = now;
    // Slew the playout offset toward its target: playback speed stays within
    // 1 ± SLEW, so a growing buffer reads as a hair of slow motion, never a stall.
    const d = this.target - this.delay, step = SLEW * dt;
    // A clock step (a suspended tab, the sender's clock restarting) is not jitter: re-sync at once.
    if (Math.abs(d) > RESYNC_MS) this.delay = this.target;
    else this.delay += Math.max(-step, Math.min(step, d));
    const m = this.model(now - this.delay);
    if (m.mode === 2) { this.extrap++; if (m.over > EXTRAP_MS) this.starved++; }
    if (!this.shown) { this.shown = { x: m.x, y: m.y }; this.lastModel = m; this.cx = this.cy = 0; return this.shown; }
    // Error correction. What the model says now vs. what it said last frame
    // plus its own motion: a discontinuity (new data overruled an
    // extrapolation) becomes an offset that decays instead of a jump.
    const lm = this.lastModel;
    const jx = m.x - lm.x, jy = m.y - lm.y;
    if (Math.abs(jx) > SNAP_PX || Math.abs(jy) > SNAP_PX) { this.cx = this.cy = 0; }
    else {
      const ex = this.expectStep(dt), maxX = Math.abs(ex) * 2 + 3;
      if (Math.abs(jx - ex) > maxX) { this.cx -= jx - ex; }
      if (Math.abs(jy) > 14) { this.cy -= jy - Math.sign(jy) * 14; }
    }
    const k = Math.exp(-dt / TAU);
    this.cx *= k; this.cy *= k;
    this.lastModel = m;
    this.shown.x = m.x + this.cx; this.shown.y = m.y + this.cy;
    return this.shown;
  };
  // Expected horizontal motion over dt from the newest velocity (for jump detection).
  Track.prototype.expectStep = function (dt) {
    const s = this.s, v = s.length ? s[s.length - 1].vx : 0;
    return v * dt;
  };
  Track.prototype.newest = function () { return this.s.length ? this.s[this.s.length - 1] : null; };
  Track.prototype.stats = function () {
    return { delay: Math.round(this.delay), target: Math.round(this.target), jitter: Math.round(this.target - this.base - this.gap), gap: Math.round(this.gap), samples: this.s.length, starved: this.starved, extrap: this.extrap };
  };

  root.SpaceManSmooth = { Track, FRAME_MS, EXTRAP_MS, SNAP_PX };
})(typeof window !== 'undefined' ? window : globalThis);
