// Bad-network bench for the in-memory relay (tests/harness.cjs).
//
// The real relay is DERP over a WebSocket: TCP on both legs, so a client never
// sees a reordered or duplicated frame on one connection. What a poor link
// (plane / train / café Wi-Fi) actually does to it is: long and variable
// delay, head-of-line bursts (a stalled TCP window releases a batch at once),
// the relay dropping frames for a peer whose queue is full, a capped uplink
// that backs frames up in the socket's send buffer, silent blackholes (radio
// gone, no FIN) and hard disconnects. Each client in the harness owns a
// `link` object that every socket it opens consults; `shape(hub)` installs
// the delivery model below. Reorder is modelled too (off by default) so the
// app-layer anti-replay window can be exercised.
//
// Deterministic: all randomness comes from a seeded PRNG per link.
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shape(hub) {
  hub.shape = (socket, bytes, deliver, dir) => {
    const L = socket.link;
    if (!L.rng) L.rng = mulberry(L.seed || 1);
    const st = socket['_' + dir] || (socket['_' + dir] = { free: 0, last: 0, inflight: 0 });
    if (L.down || socket.born < L.deadBefore) return;              // blackhole: nothing in, nothing out, no close
    const now = Date.now();
    // Queue: a capped link serialises frames; the relay drops for a peer whose queue is full.
    if (L.bandwidth > 0) {
      if (st.inflight >= (L.queueMax || 64)) return;              // relay/NIC queue overflow → drop
      const tx = bytes / L.bandwidth * 1000;
      st.free = Math.max(st.free, now) + tx;
    } else st.free = now;
    if (L.loss && L.rng() < L.loss) return;                       // relay dropped it (slow reader) — TCP never shows loss otherwise
    let at = st.free + (L.latency || 0) / 2 + (L.jitter ? (L.rng() * 2 - 1) * L.jitter / 2 : 0);
    if (L.burst && L.rng() < L.burst) at += L.burstMs || 400;     // head-of-line stall
    const reordered = L.reorder && L.rng() < L.reorder;
    st.inflight++;
    if (dir === 'up') socket.queued = (socket.queued || 0) + bytes;
    const fire = () => {
      st.inflight--;
      if (dir === 'up') socket.queued -= bytes;
      if (!socket.link.down && !(socket.born < socket.link.deadBefore)) deliver();
    };
    if (reordered) { setTimeout(fire, Math.max(0, at - now)); return; }
    // TCP keeps order: a late frame holds back everything after it. One FIFO per socket leg,
    // drained by a single timer — independent timers with near-equal deadlines can fire out
    // of creation order in Node, which would be a reorder the real transport never makes.
    at = Math.max(at, st.last); st.last = at;
    const q = st.fifo || (st.fifo = []);
    q.push({ at, fire });
    const drain = () => {
      st.timer = null;
      while (q.length && q[0].at <= Date.now()) q.shift().fire();
      if (q.length) st.timer = setTimeout(drain, Math.max(0, q[0].at - Date.now()));
    };
    if (!st.timer) st.timer = setTimeout(drain, Math.max(0, q[0].at - now));
  };
  return hub;
}
// Named link profiles (one-way numbers are applied per leg; RTT ≈ 2 × latency).
const PROFILES = {
  lan:    { latency: 10, jitter: 4 },
  cafe:   { latency: 60, jitter: 40, loss: 0.01, burst: 0.01, burstMs: 250 },
  plane:  { latency: 300, jitter: 200, loss: 0.05, burst: 0.03, burstMs: 700, bandwidth: 6000, queueMax: 24 },
  reorder:{ latency: 40, jitter: 60, reorder: 0.2 },
};
function setLink(c, profile, seed = 7) {
  Object.assign(c.link, { deadBefore: 0, latency: 0, jitter: 0, loss: 0, reorder: 0, bandwidth: 0, queueMax: 64, burst: 0, burstMs: 0, down: false }, typeof profile === 'string' ? PROFILES[profile] : profile, { seed, rng: null });
}
// Blackhole a client's radio for ms (no close events, like losing Wi-Fi on a plane).
// dead:true models a NAT rebind / network switch: sockets opened before the outage never carry
// another byte and never see a FIN either — only a fresh connection works again.
function blackhole(c, ms, { dead = false } = {}) {
  c.link.down = true;
  return new Promise((r) => setTimeout(() => { c.link.down = false; if (dead) c.link.deadBefore = Date.now(); r(); }, ms));
}
module.exports = { shape, setLink, blackhole, PROFILES, mulberry };

// ---------------------------------------------------------------------------
// Ghost trace: the host runs a scripted path (steady 300 px/s with a hop every
// 1.2 s) and streams it exactly as the game does (10 Hz presence, sim-frame
// stamped); the guest renders the host's ghost every 16 ms through the real
// game pipeline (netTick → drawGhosts) and we score what a player would see.
const V = 300;                                   // px/s — a steady run (5 px/step)
function truth(tMs) {
  const t = tMs / 1000, x = 30 + V * t;
  const ph = (t % 1.2) / 0.6;                    // 0..2: a 0.6 s hop, then 0.6 s on the ground
  const y = ph < 1 ? 250 - 120 * (1 - (2 * ph - 1) ** 2) : 250;
  return { x, y };
}
async function ghostTrace(r, { ms = 6000, profile = 'lan', seed = 7, during = null } = {}) {
  const { host, guest } = r;
  const sleep = (d) => new Promise((res) => setTimeout(res, d));
  setLink(guest, profile, seed);
  const t0 = Date.now();
  let frame = 0;
  const send = setInterval(() => {
    const tMs = Date.now() - t0, p = truth(tMs), q = truth(tMs + 16);
    frame = Math.round(tMs / (1000 / 60));
    host.net.sendPresence(p.x, p.y, 50, 8 | 1, 0, frame, Math.floor(p.x / 10), frame, (q.y - p.y) / (1000 / 60) * 16);
  }, 100);
  const samples = [];
  let last = Date.now();
  const render = setInterval(() => {
    const now = Date.now(), dt = (now - last) / 1000; last = now;
    const g = JSON.parse(guest.run(`netTick(${dt}); drawGhosts(1, G.camX); (() => { const g = ghostByP.get(1); return JSON.stringify(g && g.active ? { x: g.rx, y: g.ry, a: g.alpha } : null); })()`));
    samples.push({ t: now - t0, g });
  }, 16);
  if (during) during();
  await sleep(ms);
  clearInterval(send); clearInterval(render);
  setLink(guest, 'lan');
  return score(samples);
}
function score(samples) {
  const vis = samples.filter((s) => s.g && s.t > 1500);           // settle: ignore the first 1.5 s
  const delays = [], steps = [];
  let back = 0, freeze = 0, teleports = 0, maxStep = 0, hidden = samples.filter((s) => s.t > 1500 && !s.g).length;
  for (let i = 0; i < vis.length; i++) {
    const s = vis[i];
    delays.push((truth(s.t).x - s.g.x) / V * 1000);
    if (i) {
      const dt = s.t - vis[i - 1].t, dx = s.g.x - vis[i - 1].g.x, ideal = V * dt / 1000;
      steps.push(dx - ideal);
      if (dx < -0.5) back++;
      if (Math.abs(dx) < 0.25) freeze++;
      if (Math.abs(dx) > 60) teleports++;
      maxStep = Math.max(maxStep, Math.abs(dx));
    }
  }
  const sorted = delays.slice().sort((a, b) => a - b), pct = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN;
  const rms = Math.sqrt(steps.reduce((a, b) => a + b * b, 0) / Math.max(1, steps.length));
  return { frames: vis.length, hidden, delayMs: Math.round(pct(0.5)), delayP95: Math.round(pct(0.95)), stepRms: +rms.toFixed(2), maxStep: +maxStep.toFixed(1), back, freeze, teleports };
}
module.exports.ghostTrace = ghostTrace;
module.exports.truth = truth;
