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
const player = (o) => Object.assign({ onGround: true, vx: 0, vy: 0, dead: false, stomps: 0, hang: false, idle: 0 }, o);

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
  A.stepRig(r, player({ onGround: false, vy: -11, stomps: 1 }), STEP);
  assert.equal(r.events.stomp, 1); assert.ok(r.stomp > 0.9); assert.equal(A.eyeMood(r, 0), 1, 'happy eyes after a stomp');
  for (let i = 0; i < 40; i++) A.stepRig(r, player({ onGround: false, vy: 3, stomps: 1 }), STEP);
  assert.equal(r.stomp, 0); assert.equal(r.launch, 0); assert.equal(r.events.stomp, 1, 'holding the stomp count is not a new stomp');
  A.stepRig(r, player({ dead: true, stomps: 1 }), STEP);
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

test('a peer ghost never wears the local rig: no local stomp ring, crouch, blink or eye mood on remote runners', async (t) => {
  const { until } = require('./harness.cjs');
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  host.run(`startRun({sync:true}); G.mode = 'play'; G.freeze = 0; update();
    window.__g = ghostFor(2); Object.assign(__g, { x0: 400, x1: 400, y0: 230, y1: 230, rx: 400, ry: 230, t0: netClock() - 100, t1: netClock(), lastSeen: netClock(), alpha: 1, runId: NET.info().runId, onGround: true, vx: 0, facing: 1 });
    window.__log = []; const r2 = (v) => Math.round(v * 100) / 100;
    for (const m of ['ellipse', 'arc', 'moveTo', 'lineTo', 'drawImage', 'translate', 'scale', 'rotate']) ctx[m] = (...a) => __log.push(m + ':' + a.filter((v) => typeof v === 'number').map(r2).join(','));
    window.__draw = (fn) => { __log.length = 0; fn(); return __log.join('|'); };`);
  host.run('__draw(() => drawGhostActor(__g))');   // warm the ghost's badge cache (the harness shares one mock context)
  const ghostAtRest = host.run('__draw(() => drawGhostActor(__g))');
  const localAtRest = host.run('__draw(() => drawPlayer(1))');
  // a real local stomp through the rig's explicit signal, plus a hard-landing crouch, a blink and ^^ eyes
  host.run('rigStomps++; rigTick(); rig.crouch.x = 1; rig.blink = 0.065; rig.happy = 1; rig.launch = 1;');
  assert.ok(host.run('rig.stomp > 0.9 && rig.stompX !== undefined'), 'the local rig is mid-stomp');
  const localLive = host.run('__draw(() => drawPlayer(1))');
  assert.notEqual(localLive, localAtRest, 'the local hero shows the effects');
  assert.match(localLive, /ellipse:[^|]*,0,0,6\.28/, 'the local stomp ring is drawn');
  const ghostLive = host.run('__draw(() => drawGhostActor(__g))');
  assert.equal(ghostLive, ghostAtRest, 'the ghost draws exactly as it does with the local rig at rest');
  const ring = host.run('`ellipse:${Math.round(rig.stompX * 100) / 100},${Math.round(rig.stompY * 100) / 100}`');
  assert.ok(!ghostLive.includes(ring), 'no second stomp ring painted at the local stomp spot');
});

test('Reduce Motion: the portrait death framing snaps to the card edge instead of gliding', (t) => {
  const hub = relay(), c = client(hub, { width: 390, height: 844 });
  t.after(() => c.close());
  const frame = (reduce) => c.run(`(() => {
    settings.reduceMotion = ${reduce}; startRun(); G.mode = 'play';
    $('ovDead').firstElementChild = { getBoundingClientRect: () => ({ top: 300 }) };
    G.player.dead = true; G.deathFocus = { x: G.player.x, y: G.player.y }; G.deathSeq = 2; G.deathCardShown = true;
    G.deathPanY = 500; render(1);
    return { pan: G.deathPanY, want: Math.min(view.h * 0.3, 300 * (view.h / innerHeight) - 40) };
  })()`);
  const calm = frame(true);
  assert.ok(Math.abs(calm.pan - calm.want) < 1e-9, 'reduced motion: aim assigned directly (' + calm.pan + ' vs ' + calm.want + ')');
  const moving = frame(false);
  assert.ok(moving.pan > moving.want + 1 && moving.pan < 500, 'full motion still eases toward the card edge');
});

test('the contact shadow never lands on a slab above the feet (rising through a one-way platform)', (t) => {
  const hub = relay(), c = client(hub);
  t.after(() => c.close());
  const shadows = (setup) => c.run(`(() => {
    startRun(); G.mode = 'play';
    const p = G.player, pl = G.platforms[0]; ${setup}
    p.px = p.x; p.py = p.y; p.onGround = false; p.hang = null;
    const ys = [], orig = ART.contactShadow; ART.contactShadow = (g, x, y) => ys.push(y);
    try { drawPlayer(1); } finally { ART.contactShadow = orig; }
    return { ys, slab: pl.y + 1 };
  })()`);
  // rising: feet 10px inside the slab (platformUnder's 24px collision tolerance would pick it)
  const up = shadows('p.x = pl.x + pl.w / 2 - p.w / 2; p.y = pl.y + 10 - p.h; p.vy = -8;');
  assert.ok(!up.ys.includes(up.slab), 'no shadow painted on the overhead slab');
  // falling toward it from 60px above: the slab below takes the shadow
  const down = shadows('p.x = pl.x + pl.w / 2 - p.w / 2; p.y = pl.y - 60 - p.h; p.vy = 4;');
  assert.deepEqual([...down.ys], [down.slab], 'the slab below receives it');
});

test('a patrol alien\'s contact shadow sits on the slab it walks, not above it', (t) => {
  const hub = relay(), c = client(hub);
  t.after(() => c.close());
  const r = c.run(`(() => {
    startRun(); G.mode = 'play';
    for (let i = 0; i < 3000 && !G.enemies.some((e) => e.type === 'patrol' && !e.dead); i++) { botInput(); G.freeze = 0; G.timescale = 1; update(); if (G.player.dead) break; }
    const e = G.enemies.find((x) => x.type === 'patrol' && !x.dead);
    if (!e) return null;
    const plat = G.platforms.find((pl) => Math.abs(pl.x + 14 - e.minX) < 1e-6);
    G.enemies = [e]; e.px = e.x; e.py = e.y;
    const ys = [], orig = ART.contactShadow; ART.contactShadow = (g, x, y) => ys.push(y);
    try { drawEnemies(e.x - 100, 1); } finally { ART.contactShadow = orig; }
    return { ys: [...ys], top: plat ? plat.y : null };
  })()`);
  assert.ok(r && r.top !== null, 'a patrol alien and its platform');
  assert.equal(r.ys.length, 1);
  assert.equal(r.ys[0], r.top + 1, 'shadow centred on the platform top');
});

function liveGame(t) {
  const hub = relay(), c = client(hub);
  t.after(() => c.close());
  c.run('startRun(); G.mode = "play"; G.vigHold = false;');
  return c;
}

test('a restart after a void death starts the rig clean: no phantom landing or crouch at spawn', (t) => {
  const c = liveGame(t);
  // a real void death: airborne, below the kill line, then a few dead ticks
  c.run('G.player.onGround = false; G.player.vy = 6; G.player.y = G.groundY + 400; G.player.py = G.player.y; for (let i = 0; i < 20; i++) { G.freeze = 0; update(); }');
  assert.equal(c.run('G.player.dead'), true, 'died in the void');
  assert.equal(c.run('G.deathCause'), 'void');
  const landsBefore = c.run('rig.events.land');
  c.run('rig.happy = 0.5; rig.launch = 0.7; rig.crouch.x = 0.4; rig.tailFill = 5;');   // leftovers a stale rig would carry
  c.run('startRun(); G.mode = "play"; G.vigHold = false; G.freeze = 0; update();');
  assert.equal(c.run('G.player.dead'), false);
  assert.equal(c.run('G.player.onGround'), true, 'standing on the spawn slab');
  assert.equal(c.run('rig.events.land'), landsBefore, 'the first grounded tick of the new run is not a landing');
  assert.equal(c.run('rig.crouch.x'), 0, 'no crouch at spawn');
  assert.equal(c.run('rig.launch + rig.happy + rig.stomp + rig.hurt'), 0, 'transients cleared');
  assert.equal(c.run('rig.wasDead'), false);
});

test('only a stomp drives the stomp reaction: a rising shot kill does not, a real stomp does', (t) => {
  const c = liveGame(t);
  // run the bot until live aliens are streamed in ahead (seeded, no death)
  c.run('for (let i = 0; i < 3000 && G.enemies.filter((x) => !x.dead).length < 2; i++) { botInput(); G.freeze = 0; G.timescale = 1; update(); if (G.player.dead) break; }');
  assert.ok(c.run('G.enemies.filter((x) => !x.dead).length >= 2 && !G.player.dead'), 'two aliens to work with');
  // rising (mid-jump), a shot kills an alien through the real killEnemy path
  const shot = c.run(`(() => { const e = G.enemies.find((x) => !x.dead); const s0 = rig.events.stomp, k0 = G.killsRun;
    const p = G.player; p.onGround = false; p.vy = -10; p.jumping = true;
    killEnemy(e, 'shoot', false); rigTick();
    return { stomps: rig.events.stomp - s0, pop: rig.stomp, kills: G.killsRun - k0, mood: ANIM.eyeMood(rig, 0) }; })()`);
  assert.equal(shot.kills, 1, 'the shot counted as a kill');
  assert.equal(shot.stomps, 0, 'but not as a stomp');
  assert.equal(shot.pop, 0, 'no stomp stretch / shock ring');
  assert.notEqual(shot.mood, 1, 'no happy eyes');
  // a real stomp: fall onto an alien's head and let collisions() resolve it
  const stomp = c.run(`(() => { const e = G.enemies.find((x) => !x.dead); const s0 = rig.events.stomp, p = G.player;
    p.hang = null; p.onGround = false; p.jumping = false; p.vx = 0; p.vy = 4;
    p.x = e.x - p.w / 2; p.y = e.y - e.h / 2 - p.h + 2; p.px = p.x; p.py = p.y;
    G.freeze = 0; update();
    return { dead: e.dead, stomps: rig.events.stomp - s0, pop: rig.stomp, mood: ANIM.eyeMood(rig, 0), alive: !p.dead }; })()`);
  assert.equal(stomp.dead, true, 'the alien was stomped');
  assert.equal(stomp.alive, true);
  assert.equal(stomp.stomps, 1, 'one stomp reaction');
  assert.ok(stomp.pop > 0.5, 'stomp stretch fires');
  assert.equal(stomp.mood, 1, 'happy eyes');
});
