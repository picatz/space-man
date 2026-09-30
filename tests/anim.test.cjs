'use strict';
// The presentation rig (src/anim.js) and art kit (src/art.js) on their own: pure
// state machines and pose solvers, no game, no DOM. Plus the promise that makes
// them safe to bolt onto the renderer: stepping them never touches the run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { client, relay } = require('./harness.cjs');

function load() {
  const ctx = vm.createContext({ Math, Float32Array, Object, document: { createElement: () => ({ getContext: () => null }) } });
  for (const f of ['art', 'anim']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8'), ctx);
  return { A: ctx.SpaceManAnim, Art: ctx.SpaceManArt };
}
const { A, Art } = load();
const STEP = 1 / 60;
const pose = (o) => Object.assign({ runCycle: 0, speed: 0, onGround: true, pose: 0, hang: false, hangT: 0, crouch: 0, launch: 0, stomp: 0, groundY: 16, hipY: 4, hipX: 4, len: 6.4 }, o);
const player = (o) => Object.assign({ onGround: true, vx: 0, vy: 0, dead: false, kills: 0, hang: false, idle: 0 }, o);

test('landing compresses the knees, then the spring settles back to standing', () => {
  const r = A.createRig();
  for (let i = 0; i < 10; i++) A.stepRig(r, player({ onGround: false, vy: 12 }), STEP);
  A.stepRig(r, player({ onGround: true, vy: 0 }), STEP);
  assert.equal(r.events.land, 1);
  let peak = 0;
  for (let i = 0; i < 12; i++) { A.stepRig(r, player(), STEP); peak = Math.max(peak, r.crouch.x); }
  assert.ok(peak > 0.3, 'a hard landing crouches visibly (' + peak.toFixed(2) + ')');
  for (let i = 0; i < 90; i++) A.stepRig(r, player(), STEP);
  assert.ok(Math.abs(r.crouch.x) < 0.02, 'settles to standing within 1.5 s');
  // a feather landing crouches less than a hard one
  const soft = A.createRig();
  A.stepRig(soft, player({ onGround: false, vy: 2 }), STEP); A.stepRig(soft, player({ vy: 0 }), STEP);
  let softPeak = 0;
  for (let i = 0; i < 12; i++) { A.stepRig(soft, player(), STEP); softPeak = Math.max(softPeak, soft.crouch.x); }
  assert.ok(softPeak < peak, 'impact scales the crouch');
});

test('jump, stomp and the fatal hit are edge-detected events that decay', () => {
  const r = A.createRig();
  A.stepRig(r, player(), STEP);
  A.stepRig(r, player({ onGround: false, vy: -13 }), STEP);
  assert.equal(r.events.jump, 1); assert.ok(r.launch > 0.9);
  A.stepRig(r, player({ onGround: false, vy: -11, kills: 1 }), STEP);
  assert.equal(r.events.stomp, 1); assert.ok(r.stomp > 0.9); assert.equal(A.eyeMood(r, 0), 1, 'happy eyes after a stomp');
  for (let i = 0; i < 40; i++) A.stepRig(r, player({ onGround: false, vy: 3, kills: 1 }), STEP);
  assert.equal(r.stomp, 0); assert.equal(r.launch, 0); assert.equal(r.events.stomp, 1, 'holding the kill count is not a new stomp');
  A.stepRig(r, player({ dead: true, kills: 1 }), STEP);
  assert.equal(r.events.hurt, 1); assert.equal(A.eyeMood(r, 0), 2, 'wide eyes on the hit');
  assert.equal(A.eyeMood(A.createRig(), 20), 3, 'a long stargaze gets sleepy');
});

test('blinks are brief, regular and deterministic (no Math.random)', () => {
  const run = () => { const r = A.createRig(), closed = []; for (let i = 0; i < 60 * 30; i++) { A.stepRig(r, player(), STEP); closed.push(A.lidAmount(r) > 0.5 ? 1 : 0); } return closed; };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'same inputs, same blinks');
  let blinks = 0, longest = 0, cur = 0;
  for (const c of a) { if (c) { cur++; longest = Math.max(longest, cur); } else { if (cur) blinks++; cur = 0; } }
  assert.ok(blinks >= 6 && blinks <= 16, blinks + ' blinks in 30 s');
  assert.ok(longest <= 6, 'a blink never holds the eyes shut past 0.1 s');
});

test('legs: segments keep their length, knees bend forward, feet never sink into the slab', () => {
  const out = new Float32Array(12), L = 6.4;
  const cases = [];
  for (let c = 0; c < 64; c++) cases.push(pose({ runCycle: c * 0.2, speed: (c % 5) / 4 }));
  for (let p = -4; p <= 4; p++) cases.push(pose({ onGround: false, pose: p }), pose({ onGround: false, pose: p, stomp: 1 }), pose({ onGround: false, pose: p, launch: 1 }));
  cases.push(pose({ hang: true, hangT: 0.7 }), pose({ crouch: 1, hipY: 6.6 }));
  for (const o of cases) {
    A.legPose(o, out);
    for (let k = 0; k < 2; k++) {
      const i = k * 6, [hx, hy, kx, ky, fx, fy] = out.slice(i, i + 6);
      const thigh = Math.hypot(kx - hx, ky - hy), shin = Math.hypot(fx - kx, fy - ky);
      assert.ok(Math.abs(thigh - L) < 0.02 && Math.abs(shin - L) < 0.02, 'bone lengths hold');
      assert.ok(fy <= o.groundY + 1e-6, 'foot at or above the contact line');
      // knee sits on the facing (+x) side of the hip→foot line
      const cross = (fx - hx) * (ky - hy) - (fy - hy) * (kx - hx);
      assert.ok(cross <= 1e-6, 'knee bends forward');
      assert.ok(Number.isFinite(kx) && Number.isFinite(ky));
    }
  }
  // a stride actually strides: the two feet swap sides over a cycle
  A.legPose(pose({ runCycle: Math.PI / 2, speed: 1 }), out); const a = out[4] - out[10];
  A.legPose(pose({ runCycle: Math.PI * 1.5, speed: 1 }), out); const b = out[4] - out[10];
  assert.ok(a * b < 0, 'feet alternate');
  A.legPose(pose({ runCycle: 0, speed: 1 }), out);
  assert.ok(out[5] < 16 - 3 || out[11] < 16 - 3, 'the swing foot lifts');
});

test('comet tail follows its path, newest first, and squashes with speed', () => {
  const r = A.createRig(), pt = new Float32Array(2);
  for (let i = 0; i < 20; i++) A.stepComet(r, i * 5, 0, STEP, false);
  A.tailPoint(r, 0, pt); assert.equal(pt[0], 95);
  A.tailPoint(r, 3, pt); assert.equal(pt[0], 80);
  assert.ok(r.comet.squash > 0.2 && r.comet.look > 0.5, 'fast rightward flight stretches and looks ahead');
  A.stepComet(r, 95, 0, STEP, true); assert.ok(r.comet.happy > 0);
});

test('art kit: biome colors are pure and valid; ridge profiles tile seamlessly', () => {
  const b = Art.biome(250), b2 = Art.biome(250 + 360);
  assert.deepEqual({ ...b }, { ...b2 });
  for (const v of Object.values(b)) if (typeof v === 'string') assert.match(v, /^hsla?\(/);
  const W = 256, p = Art.ridgeProfile(W, 3, 1, new Float32Array(W + 1));
  assert.ok(Math.abs(p[0] - p[W]) < 1e-5, 'column 0 meets column W');
  for (const v of p) assert.ok(v >= 0 && v <= 1);
  assert.ok(Math.max(...p) - Math.min(...p) > 0.3, 'a real skyline, not a flat line');
  assert.equal(Art.C.cyan, '#38E1FF');
  assert.equal(Object.isFrozen(Art.C), true, 'the shared palette cannot be mutated by a plug-in');
});

test('the rig is presentation only: stepping and drawing it never changes the run', (t) => {
  const hub = relay();
  const run = (withArt) => {
    const c = client(hub);
    t.after(() => c.close());
    c.run(`resetRun(4242); G.mode = 'play'; ${withArt ? '' : 'rigTick = function(){};'}`);
    return c.run(`(() => { const out = []; for (let i = 0; i < 700; i++) { if (G.player.dead) break; botInput(); G.freeze = 0; G.timescale = 1; update(); if (i % 7 === 0) render(1);
      if (i % 50 === 0) out.push([G.player.x.toFixed(3), G.player.y.toFixed(3), G.score, G.enemies.length, G.platforms.length].join()); } return out.join('|'); })()`);
  };
  assert.equal(run(true), run(false));
});

test('touch chevrons point the way they move, and the guides dim once learned', (t) => {
  const hub = relay(), c = client(hub, { width: 390, height: 844 });
  t.after(() => c.close());
  const ctx = c.run('ctx'), pts = [];
  ctx.moveTo = (x, y) => pts.push([x, y]); ctx.lineTo = (x, y) => pts.push([x, y]);
  c.run('drawChevron(100, 50, -1)');
  assert.ok(pts[1][0] < pts[0][0], 'left chevron apex is on the left');
  pts.length = 0; c.run('drawChevron(100, 50, 1)');
  assert.ok(pts[1][0] > pts[0][0], 'right chevron apex is on the right');
  const peakGuide = () => {
    const a = [];
    Object.defineProperty(ctx, 'globalAlpha', { configurable: true, get: () => 1, set: (v) => a.push(v) });
    c.run('drawTouchControls()');
    return a.slice(3).reduce((m, v) => (v < 1 && v > m ? v : m), 0);   // skip the FIRE disc (never dims)
  };
  c.run('startRun(); G.mode = "play"; flags.taughtRun = false; flags.taughtJump = false;');
  const fresh = peakGuide();
  c.run('flags.taughtRun = true; flags.taughtJump = true;');
  const learned = peakGuide();
  assert.ok(learned > 0 && learned < fresh, 'guides step back after MOVE + JUMP are learned (' + fresh + ' → ' + learned + ')');
});
