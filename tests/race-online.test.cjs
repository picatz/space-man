const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Race = require('../src/race.js');
const Online = require('../src/race-online.js');
const C = Race.constants;
const H = Online.HEADER_BYTES, A = Online.ACTOR_BYTES, E = Online.EVENT_BYTES;
const rows = (count = 2) => Array.from({ length: count }, (_, i) => ({ p: i + 1, role: 0, identity: i ? `key-${i + 1}` : 'host' }));
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const clone = b => new Uint8Array(b);
const clock = h => h.state.tick * 1000 / C.TICK_RATE;
function setup(count = 2, options = {}) {
  const host = Online.createHost(options);
  host.syncRoster(rows(count), 0);
  assert.equal(host.start(), true);
  const client = Online.createClient();
  assert.ok(client.accept(host.packet(), 1));
  return { host, client };
}
function playing(count = 2, options = {}) {
  const s = setup(count, options);
  for (let i = 0; i < C.COUNTDOWN; i++) s.host.step(clock(s.host));
  assert.equal(s.host.state.phase, 'racing');
  assert.ok(s.client.accept(s.host.packet(), 1));
  return s;
}
function input(h, seq = 1, command = {}, recoverEdges = 0, changes = {}) {
  return Online.encodeInput({ epoch: h.epoch, tick: h.state.tick, seq, command, recoverEdges, ...changes });
}
function receive(h, seq, command = {}, edges = 0, time = clock(h), p = 1, identity = 'host') {
  return h.receive(p, identity, input(h, seq, command, edges), time);
}
function place(a, p, along = -1, speed = 4, lateral = 0) {
  Object.assign(a, { x: p.x + p.tx * along - p.ty * lateral,
    y: p.y + p.ty * along + p.tx * lateral, heading: Math.atan2(p.ty, p.tx),
    vx: p.tx * speed, vy: p.ty * speed, speed, recoveryTicks: 0 });
}
function finishActor(h, index = 0) {
  const a = h.state.actors[index];
  a.passed = h.state.laps * C.GATES - 1; a.nextGate = 0; a.lap = h.state.laps;
  a.progress = a.passed;
  place(a, Race.course(h.state.trackId).gates[0]);
  // This fixture isolates finish/grace accounting. With full-size hoverpods the
  // starting grid is close enough to bump a teleported finishing CPU backwards.
  const recovering = h.state.actors.map(p => p.recoveryTicks);
  h.state.actors.forEach(p => { if (p !== a) p.recoveryTicks = 2; });
  h.step(clock(h));
  h.state.actors.forEach((p, i) => { if (p !== a) p.recoveryTicks = recovering[i]; });
  assert.notEqual(a.finishTick, null);
}
function expectedStep(h, commands) {
  const state = Race.snapshot(h.state);
  for (const a of state.actors) if (a.controller === 'cpu') commands[a.id] = Race.cpuInput(state, a);
  Race.step(state, commands);
  return state;
}

test('race authority is a pure frozen browser/Node API without transport, DOM, clocks or randomness', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/race.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../src/race-online.js'), 'utf8');
  vm.runInNewContext(source, context);
  const api = context.window.SpaceManRaceOnline, host = api.createHost();
  host.syncRoster([{ p: 1, role: 0, identity: 'host' }], 0); host.start(); host.step(0);
  assert.equal(host.state.tick, 1); assert.ok(Object.isFrozen(api));
  assert.doesNotMatch(source, /Math\.random\(|Date\.|performance\.|document\.|WebSocket|requestAnimationFrame|setTimeout/);
});

test('configuration is bounded and changes only in lobby; five human rosters cannot silently drop racers', () => {
  assert.deepEqual(Online.configuration(null), { trackId: 'starlight', difficulty: 'normal', laps: 3 });
  assert.deepEqual(Online.configuration({ trackId: 'missing', difficulty: 'toString', laps: Infinity }), Online.configuration());
  assert.equal(Online.configuration({ laps: -10 }).laps, 1);
  assert.equal(Online.configuration({ laps: 100 }).laps, 5);
  const host = Online.createHost();
  host.syncRoster(rows(5), 0); assert.equal(host.start(), false); assert.equal(host.status, 'lobby');
  host.syncRoster(rows(4), 0);
  assert.equal(host.configure({ trackId: 'ember', difficulty: 'hard', laps: 2 }), true);
  assert.equal(host.start(), true); assert.equal(host.configure({ trackId: 'bloom' }), false);
  assert.equal(host.state.trackId, 'ember'); assert.equal(host.state.laps, 2);
  assert.equal(host.state.finishMode, 'all-humans');
  host.lobby(); assert.equal(host.configure({ trackId: 'bloom' }), true);
});

test('up to four sorted authenticated humans retain five pilots with CPU fill and ignore observers', () => {
  for (let count = 0; count <= 4; count++) {
    const host = Online.createHost();
    host.syncRoster([{ p: 8, role: 1, identity: 'observer' }, ...rows(count).reverse()], 0);
    assert.equal(host.state.actors.length, 5);
    assert.deepEqual(host.seats.map(s => [s.p, s.actorId]), rows(count).map((r, i) => [r.p, 'pilot-' + i]));
    assert.equal(host.state.actors.filter(a => a.controller === 'cpu').length, 5 - count);
    assert.ok(Online.decodeSnapshot(host.packet()));
    host.start();
    host.syncRoster([...rows(count), { p: 9, role: 0, identity: 'late-arrival' }], 0);
    assert.equal(host.seats.length, count);
    assert.equal(host.receive(9, 'late-arrival', input(host), 0), false);
    assert.equal(host.receive(8, 'observer', input(host), 0), false);
  }
});

test('roster sanitization rejects malformed, duplicate, unbounded identities and player indices', () => {
  const host = Online.createHost();
  host.syncRoster([null, {}, { p: 0, role: 0, identity: 'zero' }, { p: 49, role: 0, identity: 'high' },
    { p: 1.5, role: 0, identity: 'fraction' }, { p: 1, role: 2, identity: 'wrong-role' },
    { p: 1, role: 0, identity: 1 }, { p: 1, role: 0, identity: 'a'.repeat(129) }, ...rows(),
    { p: 3, role: 0, identity: 'host' }, { p: 2, role: 0, identity: 'duplicate-p' }], 0);
  assert.deepEqual(host.seats.map(s => s.p), [1, 2]);
  assert.equal(host.syncRoster(rows(4), NaN), false); assert.equal(host.seats.length, 2);
});

test('fixed-width inputs carry only quantized controls and cumulative rescue/Item edges and warning observations', () => {
  const bytes = Online.encodeInput({ epoch: 17, seq: 203, tick: 345, recoverEdges: 2,
    command: { steer: 999, throttle: 999, brake: true, boost: true, recover: true, passed: 60, fuel: 999, x: 1e9 } });
  assert.equal(bytes.length, Online.INPUT_BYTES); assert.equal(bytes.length, 33);
  const d = Online.decodeInput(bytes);
  assert.deepEqual(d, { epoch: 17, seq: 203, tick: 345, recoverEdges: 2, itemEdges: 0, released: false, releaseEdges: 0, warnings: [0, 0, 0, 0, 0],
    command: Race.command({ steer: 1, throttle: 1, brake: true, boost: true }) });
  const invalidAxes = Online.decodeInput(Online.encodeInput({ epoch: 1, seq: 1, tick: 0, recoverEdges: 0,
    command: { steer: NaN, throttle: Infinity, brake: 'true', boost: {} } }));
  assert.deepEqual(invalidAxes.command, Race.command());
  for (const field of ['epoch', 'seq', 'tick', 'recoverEdges', 'itemEdges']) {
    for (const value of [NaN, Infinity, -1, 1.5, '1'])
      assert.equal(Online.encodeInput({ epoch: 1, seq: 1, tick: 0, recoverEdges: 0, [field]: value }), null);
  }
  assert.equal(Online.encodeInput(null), null);
  const padded = new Uint8Array(50); padded.set(bytes, 7);
  assert.deepEqual(Online.decodeInput(padded.subarray(7, 7 + bytes.length)), d);
  assert.deepEqual(Online.decodeInput(Buffer.from(bytes)), d);
});

test('malformed input types, all truncations, trailing bytes, flags and illegal steer reject safely', () => {
  const { host } = setup(), b = input(host);
  for (const bad of [null, undefined, {}, [], [...b], b.buffer, new DataView(b.buffer), new Int8Array(b), new Uint8Array(b.length + 1)]) {
    assert.equal(Online.decodeInput(bad), null); assert.equal(host.receive(1, 'host', bad, 0), false);
  }
  for (let n = 0; n < b.length; n++) assert.equal(Online.decodeInput(b.subarray(0, n)), null);
  for (const [offset, value] of [[0, 1], [1, 2], [14, 128], [16, 8], [16, 255]]) {
    const bad = clone(b); bad[offset] = value; assert.equal(Online.decodeInput(bad), null);
  }
});

test('authenticated identity and role ownership reject forged movement, progress and guest snapshots', () => {
  const { host } = playing(4), b = input(host, 1, { throttle: 1, passed: 60, lap: 9, fuel: 999, x: 9999 });
  const before = Race.snapshot(host.state);
  for (const [p, identity] of [[2, 'host'], [1, 'key-2'], [8, 'observer'], [1, null], [1, '']])
    assert.equal(host.receive(p, identity, b, clock(host)), false);
  assert.equal(host.receive(1, 'host', host.packet(), clock(host)), false);
  assert.deepEqual(host.state, before);
  assert.equal(host.receive(1, 'host', b, clock(host)), true); host.step(clock(host));
  assert.ok(host.state.actors[0].speed > 0); assert.equal(host.state.actors[0].passed, 0);
  assert.equal(host.state.actors[0].lap, 1); assert.equal(host.state.actors[0].fuel, 100);
  host.syncRoster([{ ...rows()[0], role: 1 }, ...rows(4).slice(1)], clock(host));
  assert.equal(receive(host, 2), false);
});

test('duplicate/reordered sequences, invalid epochs, distant ticks and impossible edge counters reject', () => {
  const { host } = playing(), t = clock(host);
  assert.equal(receive(host, 2, {}, 1, t), true);
  const cases = [input(host, 0), input(host, 1), input(host, 2), input(host, 3603),
    input(host, 3, {}, 1, { epoch: host.epoch - 1 }), input(host, 3, {}, 1, { tick: host.state.tick - 121 }),
    input(host, 3, {}, 1, { tick: host.state.tick + 13 }), input(host, 3, {}, 0), input(host, 3, {}, 3)];
  for (const bytes of cases) assert.equal(host.receive(1, 'host', bytes, t + 1), false);
  assert.equal(host.receive(1, 'host', input(host, 3, {}, 1, { tick: host.state.tick - 120 }), t + 2), true);
  assert.equal(host.receive(1, 'host', input(host, 4, {}, 1, { tick: host.state.tick + 12 }), t + 3), true);
  for (const bad of [NaN, Infinity, -1, t]) assert.equal(receive(host, 5, {}, 1, bad), false);
});

test('per-seat rate limits allow bounded bursts then refill at 60 packets per second', () => {
  const { host } = setup();
  for (let i = 1; i <= 12; i++) assert.equal(receive(host, i, {}, 0, 0), true);
  assert.equal(receive(host, 13, {}, 0, 0), false);
  assert.equal(receive(host, 1, {}, 0, 0, 2, 'key-2'), true);
  assert.equal(receive(host, 13, {}, 0, 16), false);
  assert.equal(receive(host, 13, {}, 0, 17), true);
  assert.equal(receive(host, 14, {}, 0, 17), false);
  assert.equal(receive(host, 14, {}, 0, 1000), true);
});

test('cumulative rescue survives batching/loss, consumes once and held rescue never repeats', () => {
  const { host, client } = playing(), t = clock(host), a = host.state.actors[0];
  const pressed = client.input({ recover: true, throttle: 1 }, 1);
  const held = client.input({ recover: true, throttle: 1 }, 1);
  const released = client.input({ recover: false, steer: -1 }, 1);
  assert.equal(Online.decodeInput(pressed).recoverEdges, 1);
  assert.equal(Online.decodeInput(held).recoverEdges, 1);
  assert.equal(Online.decodeInput(released).recoverEdges, 1);
  assert.equal(host.receive(1, 'host', released, t), true, 'latest packet carries earlier lost press');
  assert.equal(host.receive(1, 'host', pressed, t), false, 'late press cannot duplicate');
  host.step(t); assert.equal(a.recoveries, 1); assert.equal(a.passed, 0); assert.equal(a.fuel, 75);
  for (let i = 0; i < 100; i++) host.step(clock(host));
  assert.equal(a.recoveries, 1);
  assert.ok(client.accept(host.packet(), 1));
  assert.equal(host.receive(1, 'host', client.input({ recover: true }, 1), clock(host)), true);
  host.step(clock(host)); assert.equal(a.recoveries, 2);
});

test('latest axes win but stale held controls release at 200 ms; stale rescue cannot be renewed by neutral', () => {
  for (const age of [199, 200, 250]) {
    const { host } = playing(), t = clock(host);
    assert.equal(receive(host, 1, { throttle: 1, boost: true, steer: 1 }, 0, t), true);
    const expected = expectedStep(host, { 'pilot-0': age < 200 ? Race.command({ throttle: 1, boost: true, steer: 1 }) : Race.command() });
    host.step(t + age); assert.deepEqual(host.state.actors, expected.actors);
  }
  const { host } = playing(), t = clock(host);
  receive(host, 1, { throttle: 1, steer: 1 }, 1, t);
  receive(host, 2, { steer: -1 }, 1, t + 201);
  const expected = expectedStep(host, { 'pilot-0': Race.command({ steer: -1 }) });
  host.step(t + 201); assert.deepEqual(host.state.actors, expected.actors);
  assert.equal(host.state.actors[0].recoveries, 0);
});

test('ordered checkpoint, boost, contacts and rescue use exactly the local physics engine', () => {
  const { host } = playing(4), c = Race.course(host.state.trackId);
  place(host.state.actors[0], c.gates[1], -1, 0);
  place(host.state.actors[1], c.gates[1], -20, 5);
  const commands = { 'pilot-0': Race.command(), 'pilot-1': Race.command({ throttle: 1, boost: true }),
    'pilot-2': Race.command({ recover: true }), 'pilot-3': Race.command({ steer: -1, brake: true }) };
  for (let i = 0; i < 4; i++) {
    const r = rows(4)[i]; assert.equal(receive(host, 1, commands['pilot-' + i], i === 2 ? 1 : 0, clock(host), r.p, r.identity), true);
  }
  const expected = expectedStep(host, commands); host.step(clock(host));
  assert.deepEqual(host.state, expected);
  assert.equal(host.state.actors[0].passed, 1, 'contact crossing credited by swept gate');
  assert.equal(host.state.actors[2].recoveries, 1);
  const decoded = Online.decodeSnapshot(host.packet()); assert.ok(decoded);
  assert.equal(decoded.state.actors[0].passed, 1); assert.equal(decoded.state.actors[2].recoveries, 1);
});

test('disconnect immediately releases input and identity-only rejoin preserves pilot, fuel and progress', () => {
  const { host } = playing(), t = clock(host), a = host.state.actors[1];
  receive(host, 1, { throttle: 1, boost: true }, 0, t, 2, 'key-2');
  host.syncRoster([rows()[0]], t + 10);
  assert.equal(host.seats[1].connected, false);
  const expected = expectedStep(host, {}); host.step(t + 11); assert.deepEqual(host.state.actors, expected.actors);
  host.syncRoster([rows()[0], { p: 2, role: 0, identity: 'impostor' }], t + 20);
  assert.equal(host.seats[1].connected, false);
  assert.equal(host.receive(2, 'impostor', input(host), t + 20), false);
  const before = Race.snapshot(a);
  host.syncRoster([rows()[0], { p: 7, role: 0, identity: 'key-2' }], t + 9999);
  assert.equal(host.seats[1].connected, true); assert.equal(host.seats[1].p, 7);
  assert.equal(host.seats[1].actorId, a.id); assert.deepEqual(a, { ...before, _itemHeld: true });
  assert.equal(receive(host, 2, { throttle: 1 }, 0, t + 10000, 2, 'key-2'), false);
  assert.equal(receive(host, 2, { throttle: 1 }, 0, t + 10000, 7, 'key-2'), true);
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('disconnect expiry gives explicit frozen DNF, preserves finished racers and cannot resurrect mid-race', () => {
  const { host } = playing(), t = clock(host), a = host.state.actors[1];
  host.syncRoster([rows()[0]], t);
  host.step(t + Online.REJOIN_MS - 1); assert.equal(host.seats[1].forfeited, false);
  const disconnected = Online.decodeSnapshot(host.packet());
  assert.equal(disconnected.seats[1].rejoinRemainingMs, 1);
  host.step(t + Online.REJOIN_MS); assert.equal(host.seats[1].forfeited, true); assert.equal(a.dnf, true);
  const frozen = Race.snapshot(a);
  host.syncRoster(rows(), t + Online.REJOIN_MS + 1);
  assert.equal(host.seats[1].connected, false);
  assert.equal(receive(host, 1, { throttle: 1 }, 0, t + Online.REJOIN_MS + 1, 2, 'key-2'), false);
  host.step(t + Online.REJOIN_MS + 2); assert.deepEqual(a, frozen);
  const frame = Online.decodeSnapshot(host.packet()); assert.ok(frame); assert.equal(frame.seats[1].forfeited, true);
  assert.ok(frame.state.events.some(e => e.type === 'forfeit' && e.id === a.id));
  host.lobby(); host.start(); assert.equal(host.seats[1].forfeited, false); assert.equal(host.state.actors[1].dnf, false);
  const other = playing().host; finishActor(other, 1); const finish = other.state.actors[1].finishTick;
  other.syncRoster([rows()[0]], clock(other)); other.step(clock(other) + Online.REJOIN_MS);
  assert.equal(other.state.actors[1].dnf, false); assert.equal(other.state.actors[1].finishTick, finish);
});

test('a reconnect arriving at the expiry boundary cannot revive its old seat', () => {
  const { host } = playing(), t = clock(host);
  host.syncRoster([rows()[0]], t);
  host.syncRoster(rows(), t + Online.REJOIN_MS);
  assert.equal(host.seats[1].forfeited, true); assert.equal(host.seats[1].connected, false);
  host.step(t + Online.REJOIN_MS);
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('online first human finish waits for every human, then freezes authoritative results', () => {
  const { host, client } = playing(4, { laps: 1 });
  for (let i = 0; i < 4; i++) {
    finishActor(host, i);
    assert.equal(host.state.phase, i < 3 ? 'racing' : 'finished');
    assert.equal(host.state.firstFinishTick, 1);
    const frame = client.accept(host.packet(), 1); assert.ok(frame);
    assert.equal(frame.state.actors[i].finishTick, i + 1);
    assert.equal(client.input({ throttle: 1 }, i + 1), null);
  }
  assert.equal(host.state.finishReason, 'humans');
  assert.equal(host.state.results.filter(r => r.finished).length, 4);
  assert.equal(host.state.results[4].time, null);
  assert.deepEqual(client.current.state.results, host.state.results);
  const frozen = Race.snapshot(host.state);
  host.step(clock(host) + 5000); assert.deepEqual(host.state, frozen);
  assert.equal(receive(host, 1), false);
});

test('online finish grace lasts thirty seconds, never starts from CPU finish, and has five-minute cap', () => {
  const { host } = playing(2, { laps: 1 });
  finishActor(host, 2); assert.equal(host.state.firstFinishTick, null);
  finishActor(host, 0); const first = host.state.firstFinishTick;
  host.state.raceTick = first + C.FINISH_GRACE_TICKS - 2; host.state.tick = C.COUNTDOWN + host.state.raceTick;
  host.step(clock(host)); assert.equal(host.state.phase, 'racing');
  host.step(clock(host)); assert.equal(host.state.phase, 'finished'); assert.equal(host.state.finishReason, 'grace');
  assert.ok(Online.decodeSnapshot(host.packet()));
  const cap = playing().host; cap.state.raceTick = C.MAX_RACE_TICKS - 1; cap.state.tick = C.COUNTDOWN + cap.state.raceTick;
  cap.step(clock(cap)); assert.equal(cap.state.phase, 'finished'); assert.equal(cap.state.finishReason, 'time');
  assert.ok(Online.decodeSnapshot(cap.packet()));
});

test('all forfeited humans end the race with DNF results instead of hanging or transferring authority', () => {
  const { host } = playing(), t = clock(host);
  host.syncRoster([], t); host.step(t + Online.REJOIN_MS);
  assert.equal(host.state.phase, 'finished'); assert.equal(host.state.finishReason, 'humans');
  assert.ok(host.seats.every(s => s.forfeited)); assert.ok(host.state.results.every(r => !r.finished));
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('pause/resume/new round/lobby create epochs and flush pending/held commands and edge acknowledgements', () => {
  const { host, client } = playing(), t = clock(host);
  const old = client.input({ recover: true, throttle: 1, boost: true }, 1);
  assert.equal(host.receive(1, 'host', old, t), true);
  const before = Race.snapshot(host.state), epoch = host.epoch;
  assert.equal(host.pause(true), true); assert.equal(host.epoch, epoch + 1);
  assert.equal(host.pause(true), true); assert.equal(host.epoch, epoch + 1);
  Race.cancelControl(before, undefined, { resetEdges: true });
  host.step(t + 100); assert.deepEqual(host.state, before);
  assert.equal(host.receive(1, 'host', old, t + 100), false);
  assert.equal(client.accept(host.packet(), 1).status, 'paused'); assert.equal(client.input({}, 1), null);
  host.pause(false); assert.equal(host.epoch, epoch + 2);
  assert.equal(host.receive(1, 'host', old, t + 100), false);
  assert.ok(client.accept(host.packet(), 1)); assert.equal(Online.decodeInput(client.input({}, 1)).seq, 1);
  host.step(t + 101); assert.equal(host.state.actors[0].recoveries, 0); assert.equal(host.state.actors[0].speed, 0);
  host.lobby(); assert.equal(host.epoch, epoch + 3); assert.equal(host.pause(true), false);
  assert.equal(client.accept(host.packet(), 1).status, 'lobby'); assert.equal(client.input({}, 1), null);
  host.start(); assert.equal(host.epoch, epoch + 4); assert.ok(client.accept(host.packet(), 1));
  assert.equal(Online.decodeInput(client.input({}, 1)).seq, 1);
});

test('clients require an explicit authenticated host sender and strictly monotonic revision/epoch/tick', () => {
  const { host, client } = setup(), old = host.packet(); host.step(0); const fresh = host.packet();
  for (const sender of [undefined, null, 0, 2, '1', { p: 1 }]) assert.equal(client.accept(fresh, sender), null);
  assert.ok(client.accept(fresh, 1)); const saved = client.current;
  assert.equal(client.accept(old, 1), null); assert.equal(client.accept(fresh, 1), null);
  const epoch = clone(host.packet()); view(epoch).setUint32(6, 0, true); assert.equal(client.accept(epoch, 1), null);
  const lowTick = clone(host.packet()); view(lowTick).setUint32(10, 0, true); view(lowTick).setUint16(21, 180, true);
  assert.equal(client.accept(lowTick, 1), null); assert.equal(client.current, saved);
  const alternate = Online.createClient({ hostId: 3 }); assert.equal(alternate.accept(host.packet(), 1), null);
  assert.ok(alternate.accept(host.packet(), 3)); assert.equal(client.input({}, 48), null);
});

test('snapshots are detached renderer data with deduplicated ordered effect events', () => {
  const { host, client } = playing(), t = clock(host);
  receive(host, 1, {}, 1, t); host.step(t);
  const packet = host.packet(), decoded = Online.decodeSnapshot(packet);
  assert.ok(decoded); assert.equal(decoded.state.actors[0].name, 'Nova');
  assert.equal(decoded.state.actors[0].color, host.state.actors[0].color);
  const first = client.accept(packet, 1); assert.equal(first.state.events.filter(e => e.type === 'recover').length, 1);
  assert.equal(client.accept(host.packet(), 1).state.events.length, 0);
  decoded.state.actors[0].passed = 999; decoded.seats[0].p = 99;
  assert.equal(host.state.actors[0].passed, 0); assert.equal(host.seats[0].p, 1);
  host.pause(true); client.accept(host.packet(), 1); host.pause(false); client.accept(host.packet(), 1);
  assert.equal(client.current.state.events.length, 0);
});

test('snapshots reject invalid containers, every truncation, extra bytes and oversized payloads', () => {
  const { host } = setup(4), b = host.packet();
  for (const bad of [null, undefined, {}, [], [...b], b.buffer, new DataView(b.buffer), new Int8Array(b)])
    assert.equal(Online.decodeSnapshot(bad), null);
  for (let n = 0; n < b.length; n++) assert.equal(Online.decodeSnapshot(b.subarray(0, n)), null, `truncation ${n}`);
  for (const length of [b.length + 1, Online.MAX_BYTES + 1]) {
    const extra = new Uint8Array(length); extra.set(b); assert.equal(Online.decodeSnapshot(extra), null);
  }
  const padded = new Uint8Array(b.length + 12); padded.set(b, 7);
  assert.deepEqual(Online.decodeSnapshot(padded.subarray(7, 7 + b.length)), Online.decodeSnapshot(b));
  assert.deepEqual(Online.decodeSnapshot(Buffer.from(b)), Online.decodeSnapshot(b));
});

test('snapshot validators reject nonfinite floats, illegal ranges, bad seats, checkpoints and result metadata', () => {
  const { host } = playing(4), b = host.packet();
  const edits = [
    x => { x[0] = 9; }, x => { x[1] = 1; }, x => { x[16] = 4; }, x => { x[17] = 3; },
    x => { x[18] = 0; }, x => { x[18] = 6; }, x => { x[19] = 3; }, x => { x[20] = 3; },
    x => { view(x).setUint16(21, 181, true); }, x => { view(x).setUint16(14, 18001, true); },
    x => { x[25] = 5; }, x => { x[25] = 1; }, x => { x[26] = 4; }, x => { x[27] = 5; },
    x => { x[28] = 13; }, x => { x[29] = 1; }, x => { x[H] = 1; }, x => { x[H + 1] = 49; },
    x => { x[H + A + 1] = x[H + 1]; }, x => { x[H + 2] = 3; },
    x => { view(x).setUint32(H + 7, host.state.tick + 1, true); },
    x => { view(x).setUint16(H + 11, 1, true); }, x => { view(x).setUint16(H + 58, 10001, true); },
    x => { view(x).setFloat32(H + 13, 8193, true); }, x => { view(x).setFloat32(H + 21, 4, true); },
    x => { view(x).setFloat32(H + 25, 33, true); }, x => { view(x).setFloat32(H + 33, -1, true); },
    x => { view(x).setFloat32(H + 37, 101, true); }, x => { view(x).setFloat32(H + 41, 1, true); },
    x => { x[H + 45] = 46; }, x => { x[H + 46] = 96; }, x => { x[H + 47] = 20; },
    x => { x[H + 47] = 2; }, x => { x[H + 48] = 61; }, x => { x[H + 49] = 2; },
    x => { view(x).setUint16(H + 50, 0, true); }, x => { x[H + 52] = 16; }, x => { x[H + 52] = 8; },
    x => { view(x).setUint16(H + 53, 1, true); }, x => { x[H + 55] = 91; },
    x => { view(x).setUint16(H + 56, 1, true); },
  ];
  for (const [i, edit] of edits.entries()) { const bad = clone(b); edit(bad); assert.equal(Online.decodeSnapshot(bad), null, `illegal edit ${i}`); }
  for (let f = 0; f < 8; f++) for (const value of [NaN, Infinity, -Infinity]) {
    const bad = clone(b); view(bad).setFloat32(H + 13 + f * 4, value, true);
    assert.equal(Online.decodeSnapshot(bad), null, `nonfinite field ${f}`);
  }
});

test('event validation rejects unrecognized types, identities, laps and duplicate/nonascending serials', () => {
  const { host } = playing(); receive(host, 1, {}, 1); host.step(clock(host));
  const b = host.packet(), event = H + A * 5;
  assert.ok(b[28] >= 2);
  for (const edit of [x => { view(x).setUint32(event, 0, true); }, x => { x[event + 4] = 6; },
    x => { x[event + 5] = 0; }, x => { x[event + 6] = 1; }, x => { x[event + 7] = 1; },
    x => { view(x).setUint32(event + E, view(x).getUint32(event, true), true); },
    x => { x[event + E + 5] = 5; }]) {
    const bad = clone(b); edit(bad); assert.equal(Online.decodeSnapshot(bad), null);
  }
});

for (const track of Race.tracks) {
  test(`four authenticated humans plus CPU complete ${track.id} via normal commands without path teleport`, () => {
    const { host } = setup(4, { trackId: track.id, laps: 1, difficulty: 'hard' });
    const clients = Array.from({ length: 4 }, () => Online.createClient());
    let largest = 0, steps = 0;
    while (host.state.phase !== 'finished') {
      const bytes = host.packet(); largest = Math.max(largest, bytes.length);
      assert.ok(bytes.length <= Online.MAX_BYTES);
      const frame = Online.decodeSnapshot(bytes); assert.ok(frame, `valid snapshot at tick ${host.state.tick}`);
      for (let i = 0; i < 4; i++) {
        clients[i].accept(bytes, 1);
        const a = host.state.actors[i], command = Race.cpuInput(host.state, a);
        const packet = clients[i].input(command, i + 1);
        if (packet) assert.equal(host.receive(i + 1, rows(4)[i].identity, packet, clock(host)), true);
      }
      const before = host.state.actors.map(a => ({ x: a.x, y: a.y, passed: a.passed }));
      host.step(clock(host)); steps++;
      for (const [i, a] of host.state.actors.entries()) {
        assert.ok(Math.hypot(a.x - before[i].x, a.y - before[i].y) <= 12, 'physical per-tick movement only');
        assert.ok(a.passed === before[i].passed || a.passed === before[i].passed + 1);
        assert.equal(a.recoveries, 0);
      }
      assert.ok(steps < 60 * 90, 'finish comfortably before cap');
    }
    assert.ok(host.state.actors.slice(0, 4).every(a => a.finishTick > 0 && a.passed === 20));
    assert.equal(host.state.finishReason, 'humans'); assert.ok(largest <= 648);
    assert.ok(Online.decodeSnapshot(host.packet()));
  });
}

test('zero-human host CPUs fill all five seats and physically finish every racer', () => {
  const { host } = setup(0, { laps: 1 });
  while (host.state.phase !== 'finished') host.step(clock(host));
  assert.equal(host.state.finishReason, 'all'); assert.ok(host.state.results.every(r => r.finished));
  assert.ok(host.state.actors.every(a => a.controller === 'cpu' && a.recoveries === 0));
  assert.ok(Online.decodeSnapshot(host.packet()));
});


test('roster expiry settles paused DNF without advancing physics or producing an invalid frame', () => {
  const host = Online.createHost();
  host.syncRoster([{ p: 1, role: 1, identity: 'host' }, { p: 2, role: 0, identity: 'key-2' }], 0);
  host.start();
  for (let i = 0; i <= C.COUNTDOWN; i++) host.step(clock(host));
  host.pause(true);
  const frozen = Race.snapshot(host.state);
  host.syncRoster([{ p: 1, role: 1, identity: 'host' }], 4000);
  host.syncRoster([{ p: 1, role: 1, identity: 'host' }], 14001);
  assert.equal(host.state.phase, 'finished'); assert.equal(host.state.finishReason, 'humans');
  assert.equal(host.state.tick, frozen.tick); assert.equal(host.state.raceTick, frozen.raceTick);
  assert.deepEqual(host.state.actors.slice(1), frozen.actors.slice(1), 'paused CPUs do not move');
  assert.equal(host.state.actors[0].dnf, true); assert.ok(Online.decodeSnapshot(host.packet()));
});

test('immutable curated seat callsigns and original P survive rejoin and recycled player indices', () => {
  const host = Online.createHost();
  const original = [{ p: 1, role: 0, identity: 'host', adjIdx: 7, nounIdx: 9 },
    { p: 2, role: 0, identity: 'key-2', adjIdx: 3, nounIdx: 6 }];
  host.syncRoster(original, 0); host.start();
  const snapshot = () => Online.decodeSnapshot(host.packet());
  assert.deepEqual(snapshot().seats.map(s => [s.adjIdx, s.nounIdx, s.displayP]), [[7, 9, 1], [3, 6, 2]]);
  host.syncRoster([original[0]], 0);
  host.syncRoster([original[0], { p: 2, role: 1, identity: 'new-watcher', adjIdx: 1, nounIdx: 2 }], 100);
  assert.equal(snapshot().seats[1].connected, false);
  assert.equal(snapshot().seats[1].adjIdx, 3);
  host.syncRoster([original[0], { p: 7, role: 0, identity: 'key-2', adjIdx: 22, nounIdx: 22 }], 200);
  const rejoined = snapshot().seats[1];
  assert.equal(rejoined.p, 7); assert.equal(rejoined.displayP, 2);
  assert.equal(rejoined.adjIdx, 3); assert.equal(rejoined.nounIdx, 6);
  for (const offset of [60, 61, 62]) {
    const bad = host.packet(); bad[H + offset] = offset === 62 ? 49 : 64;
    assert.equal(Online.decodeSnapshot(bad), null);
  }
  host.lobby(); host.syncRoster([{ p: 1, role: 0, identity: 'host', adjIdx: '<script>', nounIdx: 999 }], 300);
  assert.equal(snapshot().seats[0].adjIdx, 255); assert.equal(snapshot().seats[0].nounIdx, 255);
});


test('identity rejoin may use a recycled disconnected seat P without duplicate ownership', () => {
  const { host } = playing(3), t = clock(host);
  host.syncRoster([rows(3)[0]], t);
  host.syncRoster([rows(3)[0], { p: 3, role: 0, identity: 'key-2' }], t + 100);
  assert.equal(host.seats[1].p, 3); assert.equal(host.seats[1].connected, true);
  assert.equal(host.seats[2].p, 0); assert.equal(host.seats[2].connected, false);
  const frame = Online.decodeSnapshot(host.packet()); assert.ok(frame);
  assert.equal(frame.seats[2].displayP, 3); assert.equal(frame.state.actors[2].controller, 'human');
  assert.equal(receive(host, 1, { throttle: 1 }, 0, t + 100, 3, 'key-3'), false);
  assert.equal(receive(host, 1, { throttle: 1 }, 0, t + 100, 3, 'key-2'), true);
  host.syncRoster([rows(3)[0], { p: 3, role: 0, identity: 'key-2' }, { p: 7, role: 0, identity: 'key-3' }], t + 200);
  assert.equal(host.seats[2].p, 7); assert.equal(host.seats[2].connected, true);
  assert.ok(Online.decodeSnapshot(host.packet()));
});


function nearTieFinish() {
  const { host } = playing(1);
  for (const [i, progress] of [[1, 10.50000001], [2, 10.50000002]])
    Object.assign(host.state.actors[i], { passed: 10, nextGate: 11, lap: 1, progress });
  host.state.raceTick = C.MAX_RACE_TICKS;
  host.state.tick = C.COUNTDOWN + host.state.raceTick;
  Race.checkFinish(host.state);
  return host;
}

test('final ranks preserve authoritative near-tie DNF order despite float32 progress rounding', () => {
  const host = nearTieFinish(), decoded = Online.decodeSnapshot(host.packet());
  assert.ok(decoded);
  assert.ok(host.state.actors[2].progress > host.state.actors[1].progress);
  assert.equal(decoded.state.actors[1].progress, decoded.state.actors[2].progress);
  assert.deepEqual(Race.standings(decoded.state).slice(0, 2).map(a => a.id), ['pilot-1', 'pilot-2'],
    're-sorting quantized progress would produce the wrong final order');
  assert.deepEqual(host.state.results.slice(0, 2).map(r => r.id), ['pilot-2', 'pilot-1']);
  assert.deepEqual(decoded.state.results, host.state.results);
  const client = Online.createClient();
  assert.deepEqual(client.accept(host.packet(), 1).state.results, host.state.results);
});

test('final ranks must be zero before finish and an exact unique 1..5 permutation afterward', () => {
  const live = playing().host.packet();
  for (let i = 0; i < 5; i++) {
    const bad = clone(live); bad[H + A * i + 63] = 1;
    assert.equal(Online.decodeSnapshot(bad), null, `premature rank for pilot-${i}`);
  }
  const finished = nearTieFinish().packet();
  assert.equal(finished.length <= 648, true);
  for (let i = 0; i < 5; i++) {
    for (const rank of [0, 6, 255]) {
      const bad = clone(finished); bad[H + A * i + 63] = rank;
      assert.equal(Online.decodeSnapshot(bad), null, `invalid final rank ${rank} for pilot-${i}`);
    }
    const bad = clone(finished); bad[H + A * i + 63] = bad[H + A * ((i + 1) % 5) + 63];
    assert.equal(Online.decodeSnapshot(bad), null, `duplicate final rank for pilot-${i}`);
  }
});

test('three guests accept lobby and restart tick resets after pause despite dropped/reordered snapshots', () => {
  const { host } = setup(4), clients = Array.from({ length: 3 }, () => Online.createClient());
  while (host.state.tick < 497) host.step(clock(host));
  host.pause(true); const paused = host.packet();
  for (const client of clients) assert.ok(client.accept(paused, 1));
  const previousEpoch = host.epoch, previousRevision = host.revision;
  host.lobby(); const lobby = host.packet();
  host.start(); const restarted = host.packet();
  assert.equal(host.epoch, previousEpoch + 2); assert.ok(host.revision > previousRevision);
  assert.ok(clients[0].accept(lobby, 1));
  for (const client of clients) {
    assert.ok(client.accept(restarted, 1), 'new epoch accepts countdown tick zero');
    assert.equal(client.current.state.tick, 0);
    assert.equal(client.current.status, 'running');
    assert.equal(client.accept(paused, 1), null);
    assert.equal(client.accept(lobby, 1), null);
  }
  while (host.state.tick < 1074) {
    host.step(clock(host));
    if (host.state.tick % 3 === 0) {
      const bytes = host.packet();
      for (const client of clients) assert.ok(client.accept(bytes, 1));
    }
  }
  for (const client of clients) assert.equal(client.current.state.tick, 1074);
});
