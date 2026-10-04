const test = require("node:test"),
  assert = require("node:assert/strict"),
  P = require("../src/race-presentation.js"),
  R = require("../src/race.js");
const state = (tick, x, heading = 0) => ({
  tick,
  trackId: "starlight",
  phase: "racing",
  actors: [{ id: "pilot-0", x, y: 40, heading, recoveries: 0, lap: 1 }],
});
test("fixed-tick rendering interpolates every display frame without changing authoritative state", () => {
  const a = state(1, 0, Math.PI - 0.05),
    b = state(2, 10, -Math.PI + 0.05),
    before = JSON.stringify([a, b]);
  for (const [alpha, x] of [
    [0, 0],
    [0.25, 2.5],
    [0.5, 5],
    [0.75, 7.5],
    [1, 10],
  ]) {
    const shown = P.between(P.capture(a), b, alpha);
    assert.equal(shown.actors[0].x, x);
    assert.ok(Math.abs(Math.abs(shown.actors[0].heading) - Math.PI) < 0.051);
    assert.equal(shown.tick, 2);
  }
  assert.equal(JSON.stringify([a, b]), before);
});
test("teleports, recovery and rematches snap instead of sweeping through the world", () => {
  const a = state(1, 0),
    b = state(2, 800);
  assert.equal(P.between(a, b, 0.5).actors[0].x, 800);
  b.actors[0].x = 20;
  b.actors[0].recoveries = 1;
  assert.equal(P.between(a, b, 0).actors[0].x, 20);
  assert.equal(P.between(state(9, 900), state(0, 0), 0.2).actors[0].x, 0);
});
test("20Hz authoritative snapshots display continuously at60Hz without extrapolation or mutation", () => {
  const timeline = P.createTimeline(),
    samples = [],
    snapshots = [];
  let current;
  for (let frame = 0; frame < 90; frame++) {
    if (frame % 3 === 0) {
      current = state(frame, frame * 3);
      snapshots.push(JSON.stringify(current));
    }
    const shown = timeline.sample(current, (frame * 1000) / 60);
    assert.ok(shown.actors[0].x <= current.actors[0].x);
    samples.push(shown.actors[0].x);
    assert.equal(JSON.stringify(current), snapshots.at(-1));
  }
  const movement = samples.slice(9).map((x, i) => x - samples[i + 8]);
  assert.ok(movement.filter((x) => x === 0).length < 3);
  assert.ok(Math.max(...movement) < 4);
  const held = timeline.sample(current, 2500);
  assert.ok(held.actors[0].x <= current.actors[0].x);
});
test("network pause freezes latest pose and new rounds reset the presentation clock", () => {
  const t = P.createTimeline();
  t.sample(state(20, 20), 1000);
  assert.equal(t.sample(state(23, 23), 1100, { paused: true }).actors[0].x, 23);
  assert.equal(t.sample(state(0, 0), 1200).actors[0].x, 0);
  t.reset();
  assert.equal(t.sample(state(60, 30), 1300).actors[0].x, 30);
});
test("render samples remain valid for every actor from the real simulation", () => {
  const s = R.create(),
    prev = P.capture(s);
  R.step(s, {});
  const frozen = R.snapshot(s);
  frozen.actors.forEach(Object.freeze);
  Object.freeze(frozen.actors);
  Object.freeze(frozen);
  assert.ok(
    P.between(prev, frozen, 0.5).actors.every(
      (a) => Number.isFinite(a.x) && Number.isFinite(a.y),
    ),
  );
});

test("same-tick authoritative metadata updates remain current during a pause", () => {
  const t = P.createTimeline(),
    first = state(30, 10);
  t.sample(first, 1000);
  const updated = {
    ...first,
    phase: "finished",
    actors: [{ ...first.actors[0], connected: false, finishTick: 30 }],
  };
  const shown = t.sample(updated, 1010, { paused: true });
  assert.equal(shown.phase, "finished");
  assert.equal(shown.actors[0].connected, false);
  assert.equal(shown.actors[0].finishTick, 30);
});

test('height and air progress interpolate only between received samples, including landing',()=>{
  const before=state(10,10),after=state(13,19);
  Object.assign(before.actors[0],{airRamp:1,airTicks:10,z:24});Object.assign(after.actors[0],{airRamp:1,airTicks:13,z:29});
  const original=JSON.stringify([before,after]),shown=P.between(P.capture(before),after,.5).actors[0];
  assert.equal(shown.z,26.5);assert.equal(shown.airTicks,11.5);assert.equal(shown.airRamp,1);
  assert.equal(P.between(before,after,8).actors[0].z,29);
  const land=state(16,28);Object.assign(land.actors[0],{airRamp:0,airTicks:0,z:0});
  assert.equal(P.between(after,land,.5).actors[0].z,14.5);
  assert.equal(P.between(after,land,.5).actors[0].airRamp,1);
  assert.equal(P.between(after,land,1).actors[0].airRamp,0);
  assert.equal(JSON.stringify([before,after]),original);
});
test('epoch, recovery and new-hop discontinuities never blend the previous height',()=>{
  const before={...state(20,20),epoch:1},after={...state(21,23),epoch:2};
  Object.assign(before.actors[0],{z:28,airRamp:1,airTicks:12});Object.assign(after.actors[0],{z:10,airRamp:1,airTicks:0});
  assert.equal(P.between(P.capture(before),after,0).actors[0].z,10);
  after.epoch=1;assert.equal(P.between(before,after,0).actors[0].z,10,'new hop snaps even for the same ramp ID');
  after.actors[0].airRamp=0;after.actors[0].z=0;after.actors[0].recoveries=1;
  assert.equal(P.between(before,after,0).actors[0].z,0);
});
test('network loss cannot extend airtime and following another pilot resets the playback clock',()=>{
  const t=P.createTimeline(),first={...state(30,30),epoch:1},next={...state(33,39),epoch:1};
  Object.assign(first.actors[0],{z:20,airRamp:1,airTicks:6});Object.assign(next.actors[0],{z:28,airRamp:1,airTicks:9});
  t.sample(first,1000,{actorId:'pilot-0'});t.sample(next,1050,{actorId:'pilot-0'});
  for(let now=1100;now<3000;now+=50) {
    const shown=t.sample(next,now,{actorId:'pilot-0'}).actors[0];
    assert.ok(shown.z>=20&&shown.z<=28);assert.ok(shown.airTicks<=9);
  }
  assert.equal(t.sample(next,3100,{actorId:'pilot-1'}).actors[0].x,39);
  const epoch={...next,epoch:2,actors:[{...next.actors[0],x:50,z:0,airRamp:0,airTicks:0}]};
  assert.equal(t.sample(epoch,3150,{actorId:'pilot-1'}).actors[0].z,0);
});

test('canvas sampler fills the 120Hz frames between 60Hz simulation poses', () => {
  function run(hz) {
    const sampler = P.createSampler(), samples = [];
    let tick = 0, previous = null, current = state(0, 0);
    for (let frame = 0; frame <= hz; frame++) {
      const ticks = frame * 60 / hz;
      while (tick < Math.floor(ticks + 1e-8)) {
        previous = P.capture(current);
        current = state(++tick, tick * 6);
      }
      const original = JSON.stringify(current);
      const shown = sampler.sample(current, { previous, alpha: ticks - tick,
        actorId: 'pilot-0', now: frame * 1000 / hz });
      assert.equal(JSON.stringify(current), original, 'rendering never changes authority');
      samples.push(shown.actors[0].x);
    }
    return samples;
  }
  const slow = run(60), fast = run(120);
  for (let i = 2; i < slow.length; i++) assert.equal(fast[i * 2], slow[i]);
  for (let i = 3; i < fast.length; i++) assert.equal(fast[i] - fast[i - 1], 3,
    'a display-only frame still moves half a physics step');
});

test('canvas sampler resets identity/epoch/mode without blending old poses and freezes pause', () => {
  const sampler = P.createSampler(), before = state(30, 30), current = state(31, 36);
  sampler.sample(before, { actorId: 'pilot-0', epoch: 1 });
  const options = { actorId: 'pilot-0', epoch: 1, previous: P.capture(before), alpha: .5 };
  assert.equal(sampler.sample(current, options).actors[0].x, 33);
  assert.equal(sampler.sample(current, { ...options, paused: true }).actors[0].x, 36);
  assert.equal(sampler.sample(current, { ...options, epoch: 2 }).actors[0].x, 36);
  const switched = { ...current, actors: [current.actors[0], { ...current.actors[0], id: 'pilot-1', x: 90 }] };
  assert.equal(sampler.sample(switched, { ...options, actorId: 'pilot-1' }).actors[0].x, 36);
  sampler.reset();
  assert.equal(sampler.sample(current, options).actors[0].x, 36);
  const recovered = { ...current, actors: [{ ...current.actors[0], x: 80, recoveries: 1 }] };
  assert.equal(sampler.sample(recovered, options).actors[0].x, 80);
});

test('canvas network sampler smooths 20Hz arrivals and bounds loss at both display rates', () => {
  for (const hz of [60, 120]) {
    const sampler = P.createSampler(), samples = [];
    let current;
    for (let frame = 0; frame <= hz; frame++) {
      if (frame % (hz / 20) === 0) current = state(frame * 60 / hz, frame * 180 / hz);
      const shown = sampler.sample(current, { actorId: 'pilot-0', epoch: 1,
        network: true, now: frame * 1000 / hz });
      assert.ok(shown.actors[0].x <= current.actors[0].x);
      samples.push(shown.actors[0].x);
    }
    const movement = samples.slice(12).map((x, i) => x - samples[i + 11]);
    assert.ok(movement.every(x => x > 0 && x < 4), `${hz}Hz has no held-pose stairs after warming`);
    assert.equal(sampler.sample(current, { network: true, actorId: 'pilot-0', epoch: 1,
      now: 2000, paused: true }).actors[0].x, current.actors[0].x);
    for (let now = 2100; now <= 3000; now += 100) assert.equal(sampler.sample(current,
      { network: true, actorId: 'pilot-0', epoch: 1, now }).actors[0].x, current.actors[0].x);
  }
});
