const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Race = require("../src/race.js");
const C = Race.constants;
const EPSILON = 1e-8;

function close(actual, expected, label = "values should be close") {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `${label}: ${actual} vs ${expected}`,
  );
}
function playing(options = {}) {
  const state = Race.create({ count: 1, ...options });
  for (let i = 0; i < C.COUNTDOWN; i++) Race.step(state);
  assert.equal(state.phase, "racing");
  return state;
}
function place(
  actor,
  point,
  { along = 0, lateral = 0, speed = 0, reverse = false } = {},
) {
  const direction = reverse ? -1 : 1;
  Object.assign(actor, {
    x: point.x + point.tx * along - point.ty * lateral,
    y: point.y + point.ty * along + point.tx * lateral,
    heading: Math.atan2(point.ty * direction, point.tx * direction),
    vx: point.tx * speed * direction,
    vy: point.ty * speed * direction,
    speed,
    boosting: false,
    recoveryTicks: 0,
  });
}
function crossGate(
  state,
  index,
  { reverse = false, lateral = 0, actor = state.actors[0] } = {},
) {
  const c = Race.course(state.trackId);
  place(actor, c.gates[index], {
    along: reverse ? 1 : -1,
    lateral,
    speed: 4,
    reverse,
  });
  Race.step(state, { [actor.id]: { throttle: 1 } });
}
function allCpuCommands(state) {
  return Object.fromEntries(
    state.actors.map((actor) => [actor.id, Race.cpuInput(state, actor)]),
  );
}
function assertFiniteState(state) {
  for (const actor of state.actors) {
    for (const key of [
      "x",
      "y",
      "vx",
      "vy",
      "speed",
      "heading",
      "fuel",
      "progress",
    ]) {
      assert.ok(
        Number.isFinite(actor[key]),
        `${actor.id}.${key} must remain finite`,
      );
    }
    assert.ok(actor.fuel >= 0 && actor.fuel <= 100);
    assert.ok(
      actor.progress >= actor.passed && actor.progress < actor.passed + 1,
    );
    close(
      actor.speed,
      Math.hypot(actor.vx, actor.vy),
      `${actor.id} speed matches velocity`,
    );
  }
}

test("race runs as a frozen browser/Node UMD API without DOM, clocks or random globals", () => {
  const source = fs.readFileSync(require.resolve("../src/race.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const api = context.window.SpaceManRace;
  assert.equal(api.constants.TICK_RATE, 60);
  assert.equal(api.constants.GATES, 20);
  assert.equal(api.constants.STEP, 1 / 60);
  assert.equal(api.create().actors.length, 5);
  assert.equal(api.create().laps, 3);
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(api.tracks));
  assert.ok(Object.isFrozen(api.tracks[0].points[0]));
  assert.doesNotMatch(
    source,
    /Math\.random\(|Date\.|performance\.|document\.|requestAnimationFrame|setTimeout/,
  );
});

test("course geometry wraps, nearest points agree, and all 20 ordered gates are immutable", () => {
  for (const def of Race.tracks) {
    const c = Race.course(def.id);
    assert.equal(Race.course(def.id), c);
    assert.equal(c.gates.length, C.GATES);
    assert.ok(c.length > 3000);
    assert.ok(Object.isFrozen(c.gates[0]));
    assert.ok(Object.isFrozen(c.segments));
    for (let i = 0; i < C.GATES; i++) {
      const point = Race.at(c, (i * c.length) / C.GATES);
      const wrapped = Race.at(c, point.s - c.length);
      const nearest = Race.nearest(c, point.x, point.y);
      close(point.x, wrapped.x);
      close(point.y, wrapped.y);
      close(nearest.distance, 0);
      close(Math.hypot(point.tx, point.ty), 1);
      close(c.gates[i].x, point.x);
      close(c.gates[i].y, point.y);
    }
  }
  assert.equal(Race.course("missing"), Race.course(Race.tracks[0].id));
});

test("create sanitizes options and preserves stable unique identities and safe starting grids", () => {
  for (const input of [undefined, null, false, 42, "bad"]) {
    const state = Race.create(input);
    assert.equal(state.trackId, "starlight");
    assert.equal(state.difficulty, "normal");
    assert.equal(state.actors.length, 5);
    assert.equal(state.laps, 3);
  }
  const s = Race.create({
    trackId: "missing",
    difficulty: "toString",
    count: Infinity,
    laps: NaN,
  });
  assert.equal(s.trackId, "starlight");
  assert.equal(s.difficulty, "normal");
  assert.equal(s.actors.length, 5);
  assert.equal(s.laps, 3);
  assert.equal(Race.create({ count: -5, laps: 0 }).actors.length, 1);
  assert.equal(Race.create({ count: -5, laps: 0 }).laps, 1);
  assert.equal(Race.create({ count: 100, laps: 100 }).actors.length, 6);
  assert.equal(Race.create({ count: 100, laps: 100 }).laps, 5);
  for (const def of Race.tracks) {
    const state = Race.create({ trackId: def.id, count: 6 });
    assert.deepEqual(
      state.actors.map((a) => a.id),
      ["pilot-0", "pilot-1", "pilot-2", "pilot-3", "pilot-4", "pilot-5"],
    );
    assert.deepEqual(
      state.actors.map((a) => a.controller),
      ["human", "cpu", "cpu", "cpu", "cpu", "cpu"],
    );
    assert.equal(new Set(state.actors.map((a) => a.name)).size, 6);
    for (const actor of state.actors) {
      assert.ok(
        Race.nearest(Race.course(def.id), actor.x, actor.y).distance <
          def.width / 2,
      );
      assert.equal(actor.nextGate, 1);
      assert.equal(actor.passed, 0);
      assert.equal(actor.lap, 1);
      assert.equal(actor.finishTick, null);
    }
  }
});

test("commands reject nonfinite axes and truthy non-boolean actions without mutating their source", () => {
  const empty = {
    steer: 0,
    throttle: 0,
    brake: false,
    boost: false,
    recover: false,
  };
  for (const raw of [undefined, null, 2, false, "bad", [], () => {}])
    assert.deepEqual(Race.command(raw), empty);
  const raw = {
    steer: 99,
    throttle: -4,
    brake: "false",
    boost: {},
    recover: [],
  };
  assert.deepEqual(Race.command(raw), { ...empty, steer: 1 });
  assert.deepEqual(raw, {
    steer: 99,
    throttle: -4,
    brake: "false",
    boost: {},
    recover: [],
  });
  assert.deepEqual(
    Race.command({
      steer: -99,
      throttle: 99,
      brake: true,
      boost: 1,
      recover: true,
    }),
    {
      steer: -1,
      throttle: 1,
      brake: true,
      boost: true,
      recover: true,
    },
  );
  assert.deepEqual(
    Race.command({
      steer: NaN,
      throttle: Infinity,
      brake: 2,
      boost: "true",
      recover: "1",
    }),
    empty,
  );
  assert.deepEqual(Race.command({ steer: ".4", throttle: "1" }), empty);
});

test("step accepts missing and malformed command maps safely", () => {
  for (const raw of [undefined, null, 1, false, "bad"]) {
    const state = playing();
    Race.step(state, raw);
    assertFiniteState(state);
    assert.equal(state.actors[0].speed, 0);
  }
  for (const raw of [
    null,
    NaN,
    "bad",
    { steer: NaN, throttle: Infinity, recover: "false" },
  ]) {
    const state = playing();
    Race.step(state, { "pilot-0": raw, "unknown-id": { throttle: 1 } });
    assertFiniteState(state);
    assert.equal(state.actors[0].speed, 0);
    assert.equal(state.actors[0].recoveries, 0);
  }
});

test("countdown freezes all pilots and accepts no movement, boost or recover commands", () => {
  const state = Race.create();
  const initial = Race.snapshot(state).actors;
  for (let i = 1; i < C.COUNTDOWN; i++) {
    Race.step(
      state,
      Object.fromEntries(
        state.actors.map((a) => [
          a.id,
          { throttle: 1, boost: true, recover: true },
        ]),
      ),
    );
    assert.equal(state.phase, "countdown");
    assert.equal(state.countdown, C.COUNTDOWN - i);
    assert.deepEqual(state.actors, initial);
    assert.equal(state.raceTick, 0);
  }
  Race.step(state);
  assert.equal(state.phase, "racing");
  assert.equal(state.countdown, 0);
  assert.equal(state.tick, C.COUNTDOWN);
  assert.equal(state.raceTick, 0);
  assert.deepEqual(state.events, [{ type: "go" }]);
  Race.step(state);
  assert.equal(state.raceTick, 1);
  assert.deepEqual(state.events, []);
});

test("throttle, coasting, braking and speed-dependent steering share one physical model", () => {
  const state = playing();
  const a = state.actors[0],
    c = Race.course(state.trackId);
  place(a, c.gates[1], { speed: 4 });
  const coast = Race.snapshot(state),
    brake = Race.snapshot(state),
    turn = Race.snapshot(state);
  Race.step(state, { [a.id]: { throttle: 1 } });
  Race.step(coast);
  Race.step(brake, { [a.id]: { throttle: 1, brake: true } });
  Race.step(turn, { [a.id]: { steer: 1 } });
  assert.ok(state.actors[0].speed > coast.actors[0].speed);
  assert.ok(coast.actors[0].speed > brake.actors[0].speed);
  assert.ok(turn.actors[0].heading > coast.actors[0].heading);
  const still = playing();
  const oldHeading = still.actors[0].heading;
  Race.step(still, { "pilot-0": { steer: 1, brake: true } });
  assert.equal(still.actors[0].speed, 0);
  assert.ok(still.actors[0].heading > oldHeading);
  assert.ok(
    turn.actors[0].heading - coast.actors[0].heading >
      still.actors[0].heading - oldHeading,
  );
  assertFiniteState(state);
  assertFiniteState(brake);
});

test("braking cannot create backwards velocity and lateral drift decays", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  place(a, c.gates[1]);
  a.vx = -c.gates[1].ty * 2;
  a.vy = c.gates[1].tx * 2;
  a.speed = 2;
  Race.step(state, { [a.id]: { brake: true } });
  close(a.vx * c.gates[1].tx + a.vy * c.gates[1].ty, 0);
  close(a.speed, 2 * 0.82);
  place(a, c.gates[1]);
  Race.step(state, { [a.id]: { brake: true } });
  assert.equal(a.speed, 0);
});

test("boost adds acceleration and top speed, consumes bounded fuel, and yields to braking", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  place(a, c.gates[1], { speed: 6.4 });
  a.fuel = 70;
  const normal = Race.snapshot(state),
    braking = Race.snapshot(state);
  Race.step(state, { [a.id]: { throttle: 1, boost: true } });
  Race.step(normal, { [a.id]: { throttle: 1 } });
  Race.step(braking, { [a.id]: { throttle: 1, boost: true, brake: true } });
  assert.ok(a.boosting);
  assert.ok(a.speed > normal.actors[0].speed);
  close(a.fuel, 70 - 0.72);
  close(normal.actors[0].fuel, 70 + 0.17);
  assert.equal(braking.actors[0].boosting, false);
  assert.ok(braking.actors[0].fuel > 70);
  for (let i = 0; i < 1000; i++) {
    place(a, c.gates[1], { speed: a.speed });
    Race.step(state, { [a.id]: { throttle: 1, boost: true } });
    assert.ok(a.speed <= 9 + EPSILON);
    assert.ok(a.fuel >= 0 && a.fuel <= 100);
  }
  a.fuel = 0;
  Race.step(state, { [a.id]: { boost: true } });
  assert.equal(a.boosting, false);
  close(a.fuel, 0.17);
  a.fuel = 99.99;
  Race.step(state);
  assert.equal(a.fuel, 100);
});

test("boost pads trigger only on-road, boost temporarily and cannot retrigger during cooldown", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  const pad = Race.at(c, c.pads[0] * c.length);
  place(a, pad);
  Race.step(state);
  assert.equal(a.padTicks, 45);
  assert.equal(a.padCooldown, 95);
  assert.deepEqual(state.events, [{ type: "pad", id: a.id }]);
  for (let i = 0; i < 45; i++) {
    place(a, pad);
    Race.step(state);
    assert.equal(state.events.length, 0);
  }
  assert.equal(a.padTicks, 0);
  assert.equal(a.padCooldown, 50);
  for (let i = 0; i < 50; i++) {
    place(a, pad);
    Race.step(state);
  }
  assert.equal(a.padTicks, 45);
  assert.equal(state.events[0].type, "pad");
  a.padCooldown = 0;
  a.padTicks = 0;
  place(a, pad, { lateral: c.width });
  Race.step(state);
  assert.equal(a.padTicks, 0);
  assert.equal(a.offroad, true);
  assert.equal(state.events.length, 0);
});

test("offroad caps speed and disables fuel boost with bounded inward rail correction", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  place(a, c.gates[1], { lateral: c.width, speed: 8 });
  a.fuel = 50;
  const old = { x: a.x, y: a.y };
  Race.step(state, { [a.id]: { throttle: 1, boost: true } });
  assert.equal(a.offroad, true);
  assert.equal(a.boosting, false);
  assert.ok(a.speed <= 2.6 + EPSILON);
  assert.ok(Math.hypot(a.x - old.x, a.y - old.y) <= 4.6 + EPSILON);
  assert.equal(a.recoveries, 0);
  close(a.fuel, 50 + 0.17);
});

test("recovery returns to the last verified checkpoint and immediately clears stale racing state", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  a.passed = 24;
  a.nextGate = 5;
  a.lap = 2;
  a.progress = 24.99;
  a.fuel = 80;
  a.boosting = true;
  a.padTicks = 20;
  a.padCooldown = 40;
  a.offroad = true;
  place(a, c.gates[5], { along: -20, speed: 7 });
  a.boosting = true;
  Race.step(state, { [a.id]: { recover: true, boost: true, throttle: 1 } });
  const recovered = Race.at(c, (c.length * 4) / C.GATES + 12);
  close(a.x, recovered.x);
  close(a.y, recovered.y);
  assert.equal(a.passed, 24);
  assert.equal(a.nextGate, 5);
  assert.equal(a.lap, 2);
  assert.equal(a.fuel, 55);
  assert.equal(a.recoveries, 1);
  assert.ok(a.recoveryTicks > 0);
  assert.equal(a.speed, 0);
  assert.equal(a.boosting, false);
  assert.equal(a.padTicks, 0);
  assert.equal(a.offroad, false);
  close(a.progress, 24 + 12 / (c.length / C.GATES));
  assert.deepEqual(state.events, [{ type: "recover", id: a.id }]);
  for (let i = 0; i < 180; i++) Race.step(state, { [a.id]: { recover: true } });
  assert.equal(a.recoveries, 1, "holding recover must not repeat the rescue");
  Race.step(state);
  Race.step(state, { [a.id]: { recover: true } });
  assert.equal(a.recoveries, 2, "release/repress permits another rescue");
});

test("recovery locks movement for its full wait and never awards checkpoints", () => {
  const state = playing(),
    a = state.actors[0];
  Race.step(state, { [a.id]: { recover: true } });
  const x = a.x,
    y = a.y,
    fuel = a.fuel;
  while (a.recoveryTicks > 0) {
    Race.step(state, { [a.id]: { throttle: 1, boost: true, steer: 1 } });
    close(a.x, x);
    close(a.y, y);
    assert.equal(a.speed, 0);
    assert.equal(a.fuel, fuel);
    assert.equal(a.passed, 0);
    assert.equal(state.events.length, 0);
  }
  Race.step(state, { [a.id]: { throttle: 1 } });
  assert.ok(a.speed > 0);
});

test("extreme offroad positions trigger a fuel-costed rescue without forward progress", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  a.x = -10000;
  a.y = -10000;
  a.fuel = 10;
  Race.step(state, { [a.id]: { throttle: 1 } });
  assert.equal(a.recoveries, 1);
  assert.equal(a.fuel, 0);
  assert.equal(a.passed, 0);
  assert.equal(a.nextGate, 1);
  const target = Race.at(c, 12);
  close(a.x, target.x);
  close(a.y, target.y);
  assertFiniteState(state);
});

test("lap completion requires all 20 gates in order and exactly three complete laps finish", () => {
  const state = playing(),
    a = state.actors[0];
  for (let passed = 1; passed <= 60; passed++) {
    crossGate(state, passed % C.GATES);
    assert.equal(a.passed, passed);
    assert.equal(a.nextGate, (passed + 1) % C.GATES);
    assert.equal(a.lap, Math.floor(passed / C.GATES) + 1);
    assert.equal(a.finishTick === null, passed < 60);
    assert.equal(state.phase, passed < 60 ? "racing" : "finished");
    const laps = state.events.filter((e) => e.type === "lap");
    assert.equal(laps.length, passed % C.GATES === 0 ? 1 : 0);
    if (laps.length) assert.equal(laps[0].lap, a.lap);
  }
  assert.equal(a.finishTick, 60);
  assert.deepEqual(state.results, [
    { id: a.id, name: a.name, position: 1, time: 1, finished: true },
  ]);
});

test("crossing the finish line, out-of-order gates or distant track sections cannot skip checkpoints", () => {
  const state = playing(),
    a = state.actors[0];
  for (const index of [0, 2, 19, 8, 0]) {
    crossGate(state, index);
    assert.equal(a.passed, 0);
    assert.equal(a.lap, 1);
    assert.equal(a.nextGate, 1);
    assert.equal(a.finishTick, null);
    assert.ok(
      a.progress < 1,
      "unverified geometry cannot add a whole checkpoint to rank",
    );
  }
  crossGate(state, 1);
  assert.equal(a.passed, 1);
  crossGate(state, 1);
  assert.equal(a.passed, 1, "the same gate cannot be farmed twice");
  crossGate(state, 3);
  assert.equal(a.passed, 1);
});

test("backwards laps and crossing a required gate backwards give no credit", () => {
  for (const def of Race.tracks) {
    const state = playing({ trackId: def.id }),
      a = state.actors[0];
    for (let index = 19; index >= 0; index--) {
      crossGate(state, index, { reverse: true });
      assert.equal(a.passed, 0);
      assert.equal(a.nextGate, 1);
    }
    crossGate(state, 1);
    assert.equal(a.passed, 1);
    crossGate(state, 2, { reverse: true });
    assert.equal(a.passed, 1);
  }
});

test("missing the side of a gate cannot award progress and crossing it again correctly can", () => {
  const state = playing(),
    a = state.actors[0],
    c = Race.course(state.trackId);
  crossGate(state, 1, { lateral: c.width / 2 + 25 });
  assert.equal(a.passed, 0);
  crossGate(state, 1, { lateral: -c.width / 2 - 25 });
  assert.equal(a.passed, 0);
  crossGate(state, 1, { lateral: c.width / 2 - 10 });
  assert.equal(a.passed, 1);
});

test("kart contacts separate coincident pilots and keep velocities and snapshots consistent", () => {
  const state = playing({ count: 2 }),
    [a, b] = state.actors,
    c = Race.course(state.trackId);
  place(a, c.gates[1], { along: -40 });
  place(b, c.gates[1], { along: -40 });
  Race.step(state);
  close(Math.hypot(a.x - b.x, a.y - b.y), Race.constants.KART_RADIUS * 2);
  assertFiniteState(state);
  place(a, c.gates[1], { along: -35, speed: 6 });
  place(b, c.gates[1], { along: -15 });
  Race.step(state);
  assert.ok(b.speed > 0, "rear-end contact transfers some momentum");
  assert.ok(a.speed < 6 * 0.991);
  assertFiniteState(state);
});

test("a collision pushing a kart through its next gate is credited once and cannot strand it", () => {
  const state = playing({ count: 2 }),
    [a, b] = state.actors,
    c = Race.course(state.trackId);
  place(a, c.gates[1], { along: -1 });
  place(b, c.gates[1], { along: -20, speed: 5 });
  Race.step(state);
  assert.equal(a.passed, 1);
  assert.equal(a.nextGate, 2);
  assert.equal(b.passed, 0);
  Race.step(state);
  assert.equal(a.passed, 1);
});

test("finished and recovering karts cannot collide with active racers", () => {
  for (const status of ["finished", "recovering"]) {
    const state = playing({ count: 2 }),
      [a, b] = state.actors,
      c = Race.course(state.trackId);
    a.controller = "cpu";
    place(a, c.gates[1], { along: -40 });
    place(b, c.gates[1], { along: -40 });
    if (status === "finished") a.finishTick = 1;
    else a.recoveryTicks = 30;
    const position = { x: a.x, y: a.y };
    Race.step(state);
    close(a.x, position.x);
    close(a.y, position.y);
    close(b.x, position.x);
    close(b.y, position.y);
  }
});

test("standings use verified progress, finish times and stable IDs without mutating actor order", () => {
  const state = playing({ count: 5 });
  const [a, b, c, d, e] = state.actors;
  a.progress = 6.9;
  b.progress = 7.1;
  c.progress = 7.1;
  d.finishTick = 500;
  e.finishTick = 450;
  const original = state.actors.map((a) => a.id);
  assert.deepEqual(
    Race.standings(state).map((a) => a.id),
    [e.id, d.id, b.id, c.id, a.id],
  );
  assert.deepEqual(
    state.actors.map((a) => a.id),
    original,
  );
  state.actors.reverse();
  assert.deepEqual(
    Race.standings(state).map((a) => a.id),
    [e.id, d.id, b.id, c.id, a.id],
  );
});

test("human finish freezes race results and retains unfinished CPUs with null times", () => {
  const state = playing({ count: 3 }),
    [human, firstCpu] = state.actors;
  firstCpu.finishTick = 1;
  firstCpu.progress = 60;
  human.passed = 59;
  human.nextGate = 0;
  human.lap = 3;
  crossGate(state, 0);
  assert.equal(state.phase, "finished");
  assert.equal(state.results.filter((r) => r.finished).length, 2);
  assert.equal(state.results.find((r) => !r.finished).time, null);
  const frozen = Race.snapshot(state),
    oldResults = state.results;
  for (let i = 0; i < 10; i++) Race.step(state, allCpuCommands(state));
  assert.deepEqual(state.actors, frozen.actors);
  assert.equal(state.tick, frozen.tick);
  assert.equal(state.raceTick, frozen.raceTick);
  assert.equal(state.results, oldResults);
  assert.deepEqual(state.events, []);
});

test("a five-minute race timeout produces deterministic DNF results", () => {
  const state = playing({ count: 5 });
  state.raceTick = 60 * 300 - 1;
  Race.step(state);
  assert.equal(state.phase, "finished");
  assert.equal(state.raceTick, 60 * 300);
  assert.equal(state.results.length, 5);
  assert.ok(state.results.every((r) => !r.finished && r.time === null));
  assert.deepEqual(
    state.results.map((r) => r.position),
    [1, 2, 3, 4, 5],
  );
});

test("snapshots are JSON-safe, independent and can replay deterministically", () => {
  const state = playing({ count: 5, trackId: "ember" });
  for (let i = 0; i < 180; i++) Race.step(state, allCpuCommands(state));
  const restored = Race.snapshot(state);
  assert.deepEqual(restored, JSON.parse(JSON.stringify(state)));
  assert.notEqual(restored.actors, state.actors);
  assert.notEqual(restored.actors[0], state.actors[0]);
  for (let i = 0; i < 600; i++) {
    const commands = allCpuCommands(state);
    Race.step(state, commands);
    Race.step(restored, commands);
    assert.deepEqual(restored, state);
  }
  restored.actors[0].fuel = -1;
  assert.notEqual(state.actors[0].fuel, -1);
});

test("CPU command evaluation is pure and independent of controller call order", () => {
  const state = playing({ count: 5, trackId: "bloom" });
  for (let i = 0; i < 90; i++) Race.step(state, allCpuCommands(state));
  const initial = Race.snapshot(state);
  const forward = allCpuCommands(state);
  const reversed = Object.fromEntries(
    state.actors
      .slice()
      .reverse()
      .map((a) => [a.id, Race.cpuInput(state, a)]),
  );
  assert.deepEqual(forward, reversed);
  assert.deepEqual(state, initial);
  for (const command of Object.values(forward))
    assert.deepEqual(command, Race.command(command));
});

for (const track of Race.tracks) {
  for (const difficulty of ["easy", "normal", "hard"]) {
    test(`five CPUs complete three ${track.id}/${difficulty} laps by physics with zero rescues or teleports`, () => {
      const state = Race.create({ trackId: track.id, difficulty, laps: 3 });
      // Drive the human slot through the same controller too, so its finish does not end observation early.
      state.actors.forEach((a) => {
        a.controller = "cpu";
      });
      const distances = new Map(state.actors.map((a) => [a.id, 0]));
      const lapEvents = new Map(state.actors.map((a) => [a.id, 0]));
      while (state.phase !== "finished") {
        const before = state.actors.map((a) => ({
          x: a.x,
          y: a.y,
          passed: a.passed,
          nextGate: a.nextGate,
        }));
        Race.step(state, allCpuCommands(state));
        for (let i = 0; i < state.actors.length; i++) {
          const a = state.actors[i],
            old = before[i];
          const distance = Math.hypot(a.x - old.x, a.y - old.y);
          assert.ok(
            distance <= 12,
            `${a.id} moved ${distance} units in one tick`,
          );
          distances.set(a.id, distances.get(a.id) + distance);
          assert.ok(a.passed === old.passed || a.passed === old.passed + 1);
          assert.equal(a.nextGate, (a.passed + 1) % C.GATES);
          assert.equal(a.lap, Math.floor(a.passed / C.GATES) + 1);
          assert.equal(a.recoveries, 0);
        }
        for (const event of state.events) {
          assert.notEqual(event.type, "recover");
          if (event.type === "lap")
            lapEvents.set(event.id, lapEvents.get(event.id) + 1);
        }
        assertFiniteState(state);
      }
      assert.ok(
        state.raceTick < 60 * 120,
        "all pilots should finish comfortably before the race timeout",
      );
      assert.ok(
        state.results.every((r) => r.finished && Number.isFinite(r.time)),
      );
      for (const actor of state.actors) {
        assert.equal(actor.passed, 60);
        assert.equal(actor.lap, 4);
        assert.equal(lapEvents.get(actor.id), 3);
        assert.ok(actor.finishTick > 0);
        assert.ok(
          distances.get(actor.id) > Race.course(track.id).length * 2.65,
          "CPUs must physically traverse the circuit",
        );
      }
      assert.deepEqual(
        state.results.map((r) => r.id),
        Race.standings(state).map((a) => a.id),
      );
    });
  }
}

test("swept gate width is checked at the crossing, not the final drift position", () => {
  for (const side of [-1, 1]) {
    const state = playing(),
      a = state.actors[0],
      c = Race.course(state.trackId),
      gate = c.gates[1];
    const limit = c.width / 2 + 18;
    place(a, gate, { along: -1, lateral: limit + side * 0.9, speed: 4 });
    a.vx -= gate.ty * -side * 3;
    a.vy += gate.tx * -side * 3;
    Race.step(state);
    // With offroad velocity 2.6 and lateral slide 1.95, the actual crossing is
    // 0.15 outside (inward drift) or inside (outward drift) the gate boundary.
    assert.equal(a.passed, side === -1 ? 1 : 0);
    assert.equal(a.nextGate, side === -1 ? 2 : 1);
  }
});

for (const track of Race.tracks) {
  for (const difficulty of ["easy", "normal", "hard"]) {
    test(`human auto-throttle completes ${track.id}/${difficulty} using steering, brake and boost only`, () => {
      const state = Race.create({ trackId: track.id, difficulty });
      const human = state.actors[0];
      while (state.phase !== "finished") {
        const commands = allCpuCommands(state);
        // The browser UI supplies automatic throttle; CPU speed limiting is unavailable to a human.
        commands[human.id].throttle = 1;
        Race.step(state, commands);
        assert.equal(human.recoveries, 0);
        assertFiniteState(state);
      }
      assert.equal(human.passed, 60);
      assert.equal(human.lap, 4);
      assert.ok(human.finishTick > 0 && human.finishTick < 60 * 120);
      assert.equal(
        state.results.find((result) => result.id === human.id).finished,
        true,
      );
    });
  }
}
