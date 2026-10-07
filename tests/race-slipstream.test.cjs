// Slipstream (GD-04), soft CPU catch-up (GD-04) and boost camera kick (GF-04).
const test = require('node:test');
const assert = require('node:assert/strict');
const Race = require('../src/race.js');
const Camera = require('../src/race-camera.js');
const D = Race.draft, K = Race.catchup;

function playing(count = 3, difficulty = 'normal', trackId = 'starlight') {
  const s = Race.create({ trackId, count, difficulty });
  while (s.phase === 'countdown') Race.step(s);
  return s;
}
// Put a kart on the road centre line at distance s, keeping (or setting) speed.
function lay(c, a, s, speed = a.speed, lateral = 0) {
  const p = Race.at(c, s), h = Math.atan2(p.ty, p.tx);
  Object.assign(a, { x: p.x - p.ty * lateral, y: p.y + p.tx * lateral, heading: h,
    vx: Math.cos(h) * speed, vy: Math.sin(h) * speed, speed, padTicks: 0, padCooldown: 95,
    offroadTicks: 0, offroad: false, steering: 0 });
}
// Hold a formation: follower free-running, leader pinned `gap` ahead (or absent).
function run(ticks, gap, { lateral = 0, difficulty = 'normal', record } = {}) {
  const s = playing(3, difficulty), c = Race.course(s.trackId), f = s.actors[0], l = s.actors[1], far = s.actors[2];
  let sF = 150;
  lay(c, f, sF, 6.4); lay(c, far, sF + 700, 6.4);
  for (let i = 0; i < ticks; i++) {
    lay(c, f, sF, f.speed);
    lay(c, l, sF + (gap === null ? 450 : gap), 6.4, lateral);
    lay(c, far, sF + 700, 6.4);
    f.fuel = 50;
    Race.step(s, { [f.id]: Race.command({ throttle: 1 }), [l.id]: Race.command({ throttle: 1 }),
      [far.id]: Race.command({ throttle: 1 }) });
    sF = Race.nearest(c, f.x, f.y).s;
    record?.(s, f, i);
  }
  return s;
}

test('draft geometry: only directly behind, close enough, same direction', () => {
  const s = playing(2), c = Race.course(s.trackId), [a, b] = s.actors;
  lay(c, b, 400, 6); lay(c, a, 400 - 90, 6);
  assert.equal(Race.draftTarget(s, a), b);
  assert.equal(Race.draftTarget(s, b), null, 'the leader gets nothing from a kart behind it');
  lay(c, a, 400 - (D.range + 8), 6); assert.equal(Race.draftTarget(s, a), null, 'out of range');
  lay(c, a, 400 - (D.near - 6), 6); assert.equal(Race.draftTarget(s, a), null, 'inside contact distance');
  lay(c, a, 400 - 90, 6, 80); assert.equal(Race.draftTarget(s, a), null, 'far to the side');
  lay(c, a, 400 + 90, 6); assert.equal(Race.draftTarget(s, a), null, 'ahead of the leader');
  lay(c, a, 400 - 90, 1); assert.equal(Race.draftTarget(s, a), null, 'too slow');
  lay(c, a, 400 - 90, 6); a.heading += Math.PI / 2; assert.equal(Race.draftTarget(s, a), null, 'crossing traffic');
  lay(c, a, 400 - 90, 6); a.airRamp = 1; assert.equal(Race.draftTarget(s, a), null, 'airborne');
});

test('draft engages only after sustained tailing, stays bounded and then decays', () => {
  const trace = [];
  run(110, 90, { record: (s, f, i) => trace.push(f.draft) });
  for (let i = 0; i < D.engage; i++) assert.equal(trace[i], 0, 'no draft inside the first ' + D.engage + ' ticks (' + i + ')');
  assert.ok(trace[D.engage + D.rampTicks + 1] >= 0.999, 'full draft after the ramp');
  assert.ok(trace.every(v => v >= 0 && v <= 1));
  assert.ok(trace.slice(0, 70).every((v, i) => i === 0 || v >= trace[i - 1] - 1e-12), 'monotone build while tailing');
  // Lose the tow: the leader vanishes ahead and draft drains in a bounded time.
  const s = run(60, 90), c = Race.course(s.trackId), f = s.actors[0];
  assert.ok(f.draft > 0.9);
  let sF = Race.nearest(c, f.x, f.y).s, gone = 0;
  while (f.draft > 0 && gone < 60) {
    lay(c, f, sF, f.speed); lay(c, s.actors[1], sF + 450, 6.4); lay(c, s.actors[2], sF + 700, 6.4);
    Race.step(s, {}); sF = Race.nearest(c, f.x, f.y).s; gone++;
  }
  assert.equal(f.draft, 0);
  assert.ok(gone <= Math.ceil(D.full / D.decay), 'decays within ' + Math.ceil(D.full / D.decay) + ' ticks, took ' + gone);
});

test('slipstream gives a modest top-speed boost and extra boost regen, nothing off the line', () => {
  const peak = (gap, lateral = 0) => { let m = 0; run(140, gap, { lateral, record: (s, f) => { m = Math.max(m, f.speed); } }); return m; };
  const alone = peak(null), towed = peak(90), wide = peak(90, 70);
  assert.ok(alone <= 6.4 + 1e-6, 'no draft keeps the ordinary 6.4 cap: ' + alone);
  assert.ok(wide <= 6.4 + 1e-6, 'a kart beside the line is not towed: ' + wide);
  assert.ok(towed > 6.4 + 0.5 && towed <= 6.4 + D.topSpeed + 1e-6, 'tow bounded to +' + D.topSpeed + ': ' + towed);
  const regen = gap => { let last = 0; run(80, gap, { record: (s, f) => { last = f.fuel - 50; } }); return last; };
  assert.ok(regen(90) > regen(null) * 1.3, 'draft regenerates boost faster');
});

test('draft is symmetric: CPUs tow and chase the same way humans do', () => {
  const s = playing(2), c = Race.course(s.trackId), [h, cpu] = s.actors;
  assert.equal(cpu.controller, 'cpu');
  lay(c, cpu, 400, 6); lay(c, h, 310, 6);
  assert.equal(Race.draftTarget(s, h), cpu);
  lay(c, h, 400, 6); lay(c, cpu, 310, 6);
  assert.equal(Race.draftTarget(s, cpu), h, 'a CPU behind a human drafts too');
  // A CPU between its normal cruise speed and the drafted one pushes on only while towing.
  const cruise = 5.6 * (1 - (cpu.id.charCodeAt(cpu.id.length - 1) % 3) * .025);
  lay(c, cpu, 310, cruise + 0.3); cpu.draft = 0;
  assert.ok(Race.cpuInput(s, cpu).throttle < 1);
  cpu.draft = 1;
  assert.equal(Race.cpuInput(s, cpu).throttle, 1);
});

test('CPU catch-up is gentle, signed, and bounded', () => {
  const s = playing(3, 'hard'), c = Race.course(s.trackId), [h, a, b] = s.actors, gate = c.length / 20;
  const at = (kart, gates) => { lay(c, kart, 100 + gates * gate, 6); kart.passed = Math.floor(gates); };
  at(h, 5); at(a, 5); at(b, 5);
  assert.equal(Race.catchUp(s, a, c), 0, 'level with the human: no change');
  at(a, 4.5); assert.equal(Race.catchUp(s, a, c), 0, 'inside the dead band');
  at(a, 3.5); const mild = Race.catchUp(s, a, c);
  at(a, 0); const far = Race.catchUp(s, a, c);
  assert.ok(mild > 0 && mild < far, 'grows with the gap');
  assert.ok(far <= K.behind + 1e-12 && Math.abs(far - K.behind) < 1e-9, 'saturates at +' + K.behind);
  at(a, 12); const ahead = Race.catchUp(s, a, c);
  assert.ok(ahead < 0 && ahead >= -K.ahead - 1e-12, 'eases off when far ahead, bounded by -' + K.ahead);
  assert.ok(K.behind <= 0.25 && K.ahead <= 0.15);
  // Nobody to chase: the old fixed speeds are untouched.
  h.finishTick = 100; assert.equal(Race.catchUp(s, a, c), 0);
  h.finishTick = null; h.controller = 'cpu'; assert.equal(Race.catchUp(s, a, c), 0);
});

test('catch-up never lifts a CPU past the human top speed and keeps personalities distinct', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const s = playing(6, difficulty), c = Race.course(s.trackId), h = s.actors[0];
    lay(c, h, 100 + 12 * c.length / 20, 6);
    h.passed = 12;
    // Highest speed at which each CPU still throttles fully == its target.
    const targets = s.actors.slice(1).map(a => {
      lay(c, a, 100, 0); a.passed = 0; a.draft = 0;
      let lo = 0, hi = 9;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        a.speed = a.vx = mid; a.vy = 0;
        if (Race.cpuInput(s, a).throttle === 1) lo = mid; else hi = mid;
      }
      return lo;
    });
    for (const t of targets) assert.ok(t <= 6.4 + 1e-6, difficulty + ' target ' + t);
    if (difficulty !== 'hard') assert.ok(new Set(targets.map(t => t.toFixed(3))).size > 1, difficulty + ' personalities differ');
    const base = { easy: 4.5, normal: 5.6, hard: 6.35 }[difficulty];
    for (const t of targets) assert.ok(t >= base * 0.95 - 1e-6 && t > base * 0.95, 'a laggard pushes at least its own pace');
  }
});

test('simulation with draft and catch-up stays deterministic', () => {
  const play = () => {
    const s = playing(6, 'normal');
    for (let i = 0; i < 1500; i++) {
      const inputs = {};
      for (const a of s.actors) inputs[a.id] = Race.cpuInput(s, a);
      Race.step(s, inputs);
    }
    return JSON.stringify(Race.snapshot(s));
  };
  const first = play();
  assert.equal(play(), first);
  assert.ok(JSON.parse(first).actors.every(a => a.draft >= 0 && a.draft <= 1));
});

test('slipstream adds no state to the wire snapshot', () => {
  const Online = require('../src/race-online.js');
  assert.ok(Online, 'codec loads');
  const s = playing(3);
  s.actors[0].draftTicks = 33; s.actors[0].draft = 0.7;
  const json = JSON.stringify(Race.snapshot(s));
  assert.ok(json.includes('draft'), 'host state carries it locally');
  const src = require('fs').readFileSync(require.resolve('../src/race-online.js'), 'utf8');
  assert.ok(!/draft/i.test(src), 'codec has no draft field; clients derive the cue from poses');
});

test('boost camera kick: pad widens FOV for 0.6s, calm and top-down get none', () => {
  const s = Race.snapshot(playing(1)), c = Race.course(s.trackId), a = s.actors[0];
  const cam = Camera.create();
  const base = cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 }).fov;
  a.padTicks = 45;
  const kicked = cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 });
  const widened = (kicked.fov - base) * 180 / Math.PI;
  assert.ok(widened > 8 && widened <= Camera.KICK.padFov + 1e-6, 'about +9 degrees: ' + widened);
  assert.ok(kicked.boostKick > 0.95);
  let last = kicked.fov, v;
  for (let i = 0; i < 20; i++) { v = cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 }); a.padTicks--; assert.ok(v.fov <= last + 1e-12); last = v.fov; }
  for (let i = 0; i < 30; i++) v = cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 });
  assert.equal(v.boostKick, 0, 'fully decayed by 0.6s');
  // An ongoing pad does not retrigger; a fresh one does.
  a.padTicks = 0; cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 });
  a.padTicks = 30; assert.ok(cam.update(a, c, Race.at, { mode: 'chase', dt: 1 / 60 }).boostKick > 0.95);
  const calm = Camera.create(); a.padTicks = 0;
  const calmBase = calm.update(a, c, Race.at, { mode: 'chase', reduceMotion: true }).fov;
  a.padTicks = 45;
  const calmKick = calm.update(a, c, Race.at, { mode: 'chase', reduceMotion: true });
  assert.equal(calmKick.fov, calmBase);
  assert.equal(calmKick.boostKick, 0);
  const boost = Camera.create(); a.padTicks = 0; a.boosting = false;
  boost.update(a, c, Race.at, { mode: 'cockpit', dt: 1 / 60 });
  a.boosting = true;
  const half = boost.update(a, c, Race.at, { mode: 'cockpit', dt: 1 / 60 });
  assert.ok(half.boostKick > 0.4 && half.boostKick < 0.6, 'boost button gives a smaller kick');
});
