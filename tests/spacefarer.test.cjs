// The Spacefarer rig: one deterministic, filter-free astronaut that paints its helmet last.
const test = require('node:test'), assert = require('node:assert/strict');
const Art = require('../src/art.js'), Cosmetics = require('../src/cosmetics.js');

// A recording 2D context: every call and property write, in order, with save/restore state.
function recorder() {
  const calls = [], stack = [], state = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'save') return () => { stack.push({ ...target }); calls.push(['save']); };
      if (key === 'restore') return () => { const s = stack.pop(); Object.keys(target).forEach(k => delete target[k]); Object.assign(target, s); calls.push(['restore']); };
      return (...args) => {
        assert.ok(!/Gradient$|^getImageData$/.test(key), 'no per-frame gradient or readback: ' + key);
        assert.ok(args.every(v => typeof v !== 'number' || Number.isFinite(v)), key + ' has finite arguments');
        calls.push([key, ...args]);
      };
    },
    set(target, key, value) {
      assert.ok(!/^(shadowBlur|shadowColor|filter)$/.test(key), 'no blur or filter: ' + key);
      if (typeof value === 'number') assert.ok(Number.isFinite(value), key + ' finite');
      target[key] = value; calls.push(['=' + key, value]); return true;
    },
  });
  return { ctx, calls, stack };
}
const draw = (pose, appearance = Cosmetics.DEFAULTS) => { const r = recorder(); Art.drawSpacefarer(r.ctx, 100, 120, 3, appearance, pose); assert.equal(r.stack.length, 0, 'balanced save/restore'); return r.calls; };
// The visor glass colour marks the helmet; everything after it belongs to the head.
const helmetIndex = calls => calls.findIndex(c => c[0] === '=fillStyle' && c[1] === '#102D49');   // visor glass, after the shell
const strokes = calls => calls.filter(c => c[0] === 'stroke' || c[0] === 'fill').length;

const POSES = {
  idle: { t: 1.2 },
  run: { speed: 1, runCycle: 2.1, t: .4 },
  rise: { onGround: false, air: -1, launch: .5 },
  fall: { onGround: false, air: 1 },
  land: { squashX: 1.15, squashY: .85, crouch: .8 },
  attack: { attack: .3, gear: 'emitter', gearColor: '#FFB454' },
  windup: { attack: .05, gear: 'emitter' },
  hit: { hit: 1, onGround: false, air: -.4 },
  celebrate: { celebrate: 1, t: .7 },
  wave: { wave: 1, t: .2 },
  hang: { hang: true, hangT: .5, onGround: false },
  recoil: { recoil: 1, gear: 'blaster' },
  aim: { aim: 1, gear: 'emitter' },
  guardian: { guardian: true, eyes: 'determined', accent: '#FF4F66' },
};

test('every named action paints a full body with the helmet last', () => {
  for (const [name, pose] of Object.entries(POSES)) for (const facing of [1, -1]) {
    const calls = draw({ ...pose, facing }), h = helmetIndex(calls);
    assert.ok(h > 0, name + ' paints a helmet');
    // Limbs are stroked capsules; none may be stroked after the helmet shell (hats and
    // visor details are fills and short arcs inside the helmet's own transform).
    const limbAfter = calls.slice(h).some(c => c[0] === '=lineWidth' && c[1] >= 2.8 && c[1] !== 4);
    assert.equal(limbAfter, false, name + ': no limb draws over the visor');
    assert.ok(strokes(calls.slice(0, h)) > 30, name + ' has legs, pack, arms and torso under the head');
  }
});

test('the rig is deterministic and pure', () => {
  for (const pose of Object.values(POSES)) {
    const frozen = Object.freeze({ ...pose, t: 2.5 });
    assert.deepEqual(draw(frozen), draw(frozen));
  }
  const random = Math.random; Math.random = () => { throw new Error('rig used Math.random'); };
  try { for (const pose of Object.values(POSES)) draw(pose); } finally { Math.random = random; }
});

test('calm draws a still pose: decorative time never moves the body', () => {
  for (const name of ['idle', 'wave', 'celebrate', 'run', 'land']) {
    const a = draw({ ...POSES[name], calm: true, t: 0, tick: 20 }), b = draw({ ...POSES[name], calm: true, t: 3.7, tick: 400 });
    assert.deepEqual(a, b, name + ' is still under reduced motion');
  }
  // ...while full motion breathes and waves over time.
  assert.notDeepEqual(draw({ t: 0 }), draw({ t: .5 }));
  assert.notDeepEqual(draw({ wave: 1, t: 0 }), draw({ wave: 1, t: .1 }));
});

test('poses actually change the drawing', () => {
  const sigs = Object.entries(POSES).map(([, pose]) => JSON.stringify(draw(pose)));
  assert.equal(new Set(sigs).size, sigs.length, 'each action has its own silhouette');
  const strides = [0, 1, 2, 3, 4, 5].map(i => JSON.stringify(draw({ speed: 1, runCycle: i * Math.PI / 3 })));
  assert.equal(new Set(strides).size, 6, 'six distinct run frames');
});

test('cosmetics are parameters: every suit, hat, helmet and accent paints through the same rig', () => {
  const base = draw({});
  for (const slot of ['suit', 'hat', 'eyes', 'helmet', 'detail']) for (const id of Cosmetics.ORDERS[slot]) {
    const calls = draw({ speed: .5, runCycle: 1 }, Object.freeze({ ...Cosmetics.DEFAULTS, [slot]: id }));
    assert.ok(helmetIndex(calls) > 0);
  }
  assert.notDeepEqual(draw({ accent: '#FFB454' }), base, 'team accent shows on the body');
  assert.ok(draw({ accent: '#FFB454' }).some(c => c[0] === '=fillStyle' && c[1] === '#FFB454'));
  // Run palette override (the Run passes its live PALETTES entry).
  const gold = Cosmetics.PALETTES.gold;
  assert.ok(draw({ palette: gold }).some(c => c[0] === '=fillStyle' && c[1] === gold.pack), 'pack takes the palette pack colour');
});

test('feet stay planted: ground squash pivots at the contact point', () => {
  // On the ground the first transform is translate(x, y) to the contact point, then
  // rotate/scale, so the boots stay on y whatever the squash.
  const calls = draw({ squashX: 1.2, squashY: .8 });
  const i = calls.findIndex(c => c[0] === 'translate');
  assert.deepEqual(calls[i], ['translate', 100, 120]);
  assert.equal(calls[i + 1][0], 'scale');
  assert.equal(calls[i + 2][0], 'rotate');
});

test('spacefarerPose derives Run-like motion from plain inputs', () => {
  const out = {};
  const run = Art.spacefarerPose({ x: 50, vx: 6.8, onGround: true, facing: 1, t: 1 }, out);
  assert.equal(run, out, 'writes into the caller-owned object');
  assert.equal(run.speed, 1); assert.ok(run.lean > 0); assert.equal(run.runCycle, 50 * .06);
  const left = Art.spacefarerPose({ x: 50, vx: -6.8, facing: -1 }, {});
  assert.ok(left.lean < 0); assert.equal(left.runCycle, -50 * .06);
  const air = Art.spacefarerPose({ vy: -9, onGround: false }, {});
  assert.equal(air.air, -1); assert.equal(air.speed, 0); assert.equal(air.lookY, -.5);
  const land = Art.spacefarerPose({ squash: { x: 1.15, y: .85 } }, {});
  assert.ok(land.crouch > .5 && land.squashY === .85);
  for (const action of ['wave', 'attack', 'hit', 'celebrate', 'aim']) assert.equal(Art.spacefarerPose({ action, actionT: .5 }, {})[action], .5);
  assert.equal(Art.spacefarerPose({ action: 'hang' }, {}).hang, true);
  // Every derived pose draws.
  for (const action of ['idle', 'run', 'wave', 'attack', 'hit', 'celebrate', 'hang', 'aim']) assert.ok(helmetIndex(draw(Art.spacefarerPose({ action, vx: 3, x: 10 }, {}))) > 0);
});

test('drawAvatar renders through the rig, keeping the hoverpod branch', () => {
  const r = recorder(); Art.drawAvatar(r.ctx, 50, 50, 108, Cosmetics.DEFAULTS, { time: 1 });
  // The avatar's helmet lands where it always did: (x, y + size*.13 - 9*size/54).
  const scale = r.calls.filter(c => c[0] === 'scale' && c[1] === 2 && c[2] === 2);
  assert.ok(scale.length >= 1, 'size 108 is the rig at 2x');
  assert.ok(helmetIndex(r.calls) > 0);
  const ship = recorder(); Art.drawAvatar(ship.ctx, 50, 50, 108, Cosmetics.DEFAULTS, { ship: true });
  assert.ok(ship.calls.length > 50); assert.equal(ship.stack.length, 0);
  const armed = recorder(); Art.drawAvatar(armed.ctx, 0, 0, 160, Cosmetics.DEFAULTS, { blaster: '#38E1FF' });
  assert.ok(armed.calls.some(c => c[0] === '=fillStyle' && c[1] === '#38E1FF'), 'the lobby emitter takes its colour');
});

test('celebrate hops off the slab, and reduced motion keeps the feet planted', () => {
  // The first translate is the ground contact point; a hop lifts it above y = 120.
  const lift = pose => draw(pose).find(c => c[0] === 'translate')[2];
  assert.ok(lift({ celebrate: 1, t: Math.PI / 12 }) < 120 - 6, 'mid-hop the body clears the ground');
  assert.equal(lift({ celebrate: 1, t: Math.PI / 12, calm: true }), 120);
  assert.equal(lift({ t: 1 }), 120, 'idle never leaves the ground');
});

test('limbs read as one suit: sleeves, legs, cuffs and boots share widths', () => {
  const widths = calls => calls.filter(c => c[0] === '=lineWidth').map(c => c[1]);
  const w = widths(draw({ t: .4 }));
  // Legs then arms: an outline one hairline wider than each fill, arms a touch slimmer than legs.
  const M = Art.SPACEFARER;
  for (const fill of [M.leg.w, M.arm.w]) { assert.ok(w.includes(fill)); assert.ok(w.some(v => Math.abs(v - fill - M.edge) < 1e-9)); }
  // A running arm folds at the elbow: the sleeve is a two-segment polyline, not a single curve.
  const run = draw({ speed: 1, runCycle: 1 });
  assert.equal(run.filter(c => c[0] === 'quadraticCurveTo' && c.length === 5 && Math.abs(c[3]) > 8).length, 0, 'no single-curve sleeves');
  assert.ok(run.filter(c => c[0] === 'lineTo').length >= 8, 'two-bone legs and arms');
});

test('the comms aerial trails motion as follow-through', () => {
  const tip = pose => { const calls = draw(pose), i = calls.findIndex(c => c[0] === '=lineWidth' && c[1] === 1.4); return calls.slice(i).find(c => c[0] === 'quadraticCurveTo'); };
  assert.deepEqual(tip({ calm: true }), tip({ calm: true, lean: .14 }), 'calm keeps the aerial still');
  assert.notDeepEqual(tip({ t: 1 }), tip({ t: 1, lean: .14, speed: 1, runCycle: 1 }), 'a running pilot whips its aerial');
});

test('the model sheet stands the pilot up straight: legs reach the ground unbent, boots under the hips', () => {
  const M = Art.SPACEFARER, stand = M.leg.ankle - M.hip.y;
  assert.ok(stand <= M.leg.seg * 2 && stand > M.leg.seg * 2 - .4, 'standing legs are nearly straight (' + stand + ' of ' + M.leg.seg * 2 + ')');
  assert.ok(M.leg.ankle + M.boot.sole <= M.ground + .1 && M.leg.ankle + M.boot.sole > M.ground - .6, 'soles meet the ground');
  assert.ok(M.leg.ankle - M.boot.top > M.torso.y + M.torso.h + 2, 'shins show between torso and boots');
  // A different sheet (a future character) paints through the same rig.
  const tall = Object.freeze({ ...M, leg: Object.freeze({ ...M.leg, seg: 6 }), hip: Object.freeze({ ...M.hip, y: 3.2 }) });
  assert.notDeepEqual(draw({ model: tall }), draw({}));
});
