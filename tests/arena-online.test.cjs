const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Arena = require('../src/arena.js');
const Online = require('../src/arena-online.js');
const C = Arena.constants;
const HEADER = 27, EVENT = 18;
const rows = (count = 2) => Array.from({ length: count }, (_, i) => ({ p: i + 1, role: 0, identity: `key-${i + 1}` }));
function setup(format = 'duel', count = format === 'duel' ? 2 : 4) {
  const host = Online.createHost({ format });
  host.syncRoster(rows(count), 0);
  assert.equal(host.start(42), true);
  const client = Online.createClient();
  assert.ok(client.accept(host.packet()));
  return { host, client };
}
function playing(format, count) {
  const s = setup(format, count);
  for (let i = 0; i < C.COUNTDOWN_TICKS; i++) s.host.step(i * 1000 / 60);
  s.host.state.actors.forEach(a => { a.invulnerable = 0; });
  assert.ok(s.client.accept(s.host.packet()));
  return s;
}
function input(host, seq = 1, command = {}, edges = [0, 0, 0], overrides = {}) {
  return Online.encodeInput({ epoch: host.epoch, tick: host.state.tick, seq, command, edges, ...overrides });
}
function place(a, x, y, extra = {}) {
  Object.assign(a, { x, y, px: x, py: y, vx: 0, vy: 0, invulnerable: 0, stun: 0, onGround: true, supportId: 'dock', coyoteTicks: C.COYOTE_TICKS, attackTicks: 0, dashTicks: 0, jumpCount: 0, jumpBufferTicks: 0 }, extra);
}
function clone(b) { return new Uint8Array(b); }
function actorBytes(b) { return (b.length - HEADER - EVENT * b[26]) / b[23]; }
function view(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
function finishAttack(host, now = 10) {
  for (let i = 0; i < C.ATTACK_TICKS + 2; i++) host.step(now + i * 1000 / 60);
}

test('online authority module works in browser and Node without clocks, DOM, or sockets', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/arena.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../src/arena-online.js'), 'utf8');
  vm.runInNewContext(source, context);
  const host = context.window.SpaceManArenaOnline.createHost();
  host.syncRoster([{ p: 1, role: 0, identity: 'host' }], 0);
  assert.equal(host.start(1), true);
  host.step(0);
  assert.equal(host.state.tick, 1);
  assert.doesNotMatch(source, /Math\.random\(|Date\.|performance\.|document\.|WebSocket|requestAnimationFrame|setTimeout/);
});

test('lobby configuration sanitizes values and can only change before a round', () => {
  const host = Online.createHost({ arenaId: 'bad', format: 'bad', difficulty: 'toString' });
  assert.deepEqual(Online.configuration(null), { arenaId: Arena.arenas[0].id, format: 'duel', difficulty: 'normal' });
  assert.equal(host.status, 'lobby');
  assert.equal(host.state.difficulty, 'normal');
  host.syncRoster(rows(4), 0);
  assert.equal(host.start(), false, 'cannot silently exclude two humans from a duel');
  assert.equal(host.status, 'lobby');
  assert.equal(host.configure({ arenaId: Arena.arenas[1].id, format: 'teams', difficulty: 'hard' }), true);
  assert.equal(host.start(99), true);
  assert.equal(host.state.seed, 99);
  assert.equal(host.state.arenaId, Arena.arenas[1].id);
  assert.equal(host.state.difficulty, 'hard');
  assert.equal(host.configure({ format: 'duel' }), false);
  assert.equal(host.state.format, 'teams');
  host.lobby();
  assert.equal(host.status, 'lobby');
  assert.equal(host.configure({ format: 'ffa' }), true);
});

test('seats are stable, sorted, alternate teams, ignore spectators, and CPU-fill vacancies', () => {
  const host = Online.createHost({ format: 'teams' });
  host.syncRoster([{ p: 9, role: 1, identity: 'viewer' }, ...rows(3).reverse()], 0);
  assert.deepEqual(host.seats.map(s => [s.p, s.actorId]), [[1, 1], [2, 3], [3, 2]]);
  assert.deepEqual(host.seats.map(s => host.state.actors[s.actorId - 1].team), [0, 1, 0]);
  assert.deepEqual(host.state.actors.map(a => a.controller), ['human', 'human', 'human', 'cpu']);
  host.start(1);
  const assigned = host.seats.map(s => [s.p, s.actorId]);
  host.syncRoster([...rows(3).reverse(), { p: 4, role: 0, identity: 'newcomer' }], 10);
  assert.deepEqual(host.seats.map(s => [s.p, s.actorId]), assigned, 'joining mid-round cannot take over a CPU');
  assert.equal(host.receive(4, 'newcomer', input(host), 10), false);
  assert.equal(host.receive(9, 'viewer', input(host), 10), false);
});

test('roster validation rejects invalid identities, roles, and player indices', () => {
  const host = Online.createHost();
  host.syncRoster([null, {}, { p: 0, role: 0, identity: 'zero' }, { p: 49, role: 0, identity: 'high' }, { p: 1.5, role: 0, identity: 'fraction' }, { p: 1, role: 2, identity: 'bad-role' }, { p: 1, role: 0, identity: 42 }, ...rows()], 0);
  assert.deepEqual(host.seats.map(s => s.p), [1, 2]);
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('input serializer is exact-width, clamps axes, and roundtrips bounded command data', () => {
  const b = Online.encodeInput({ epoch: 17, seq: 204, tick: 345, command: { moveX: 999, moveY: -999, jumpHeld: true, damage: 999, stocks: 999 }, edges: [2, 5, 9] });
  assert.equal(b.length, Online.INPUT_BYTES);
  const decoded = Online.decodeInput(b);
  assert.equal(decoded.epoch, 17); assert.equal(decoded.seq, 204); assert.equal(decoded.tick, 345);
  assert.deepEqual(decoded.edges, [2, 5, 9]);
  assert.deepEqual(decoded.command, Arena.normalizeCommand({ moveX: 1, moveY: -1, jumpHeld: true }));
  const invalid = Online.encodeInput({ epoch: 1, seq: 1, tick: 0, command: { moveX: NaN, moveY: Infinity }, edges: [0, 0, 0] });
  assert.equal(Online.decodeInput(invalid).command.moveX, 0);
  assert.equal(Online.decodeInput(invalid).command.moveY, 0);
  assert.ok(Online.decodeInput(Buffer.from(b)));
  const padded = new Uint8Array(b.length + 13); padded.set(b, 7);
  assert.deepEqual(Online.decodeInput(padded.subarray(7, 7 + b.length)), decoded, 'honor byteOffset');
});

test('malformed input shapes, widths, versions, types, and flags are rejected without throwing', () => {
  const { host } = setup(), b = input(host);
  for (const malformed of [null, undefined, {}, [], [...b], '', b.buffer, new DataView(b.buffer), new Int8Array(b), b.subarray(1), new Uint8Array(b.length + 1)]) {
    assert.equal(Online.decodeInput(malformed), null);
    assert.equal(host.receive(1, 'key-1', malformed, 0), false);
  }
  for (const [offset, val] of [[0, 0], [0, 2], [1, 2], [1, 255], [16, 2], [16, 255]]) {
    const bad = clone(b); bad[offset] = val;
    assert.equal(Online.decodeInput(bad), null);
  }
});

test('authenticated seat ownership, identity, role, and input-only authority are enforced', () => {
  const { host } = playing(), b = input(host, 1, { moveX: 1, damage: 900, stocks: 9 });
  const before = Arena.snapshot(host.state);
  for (const [p, key] of [[2, 'key-1'], [1, 'key-2'], [3, 'key-3'], [1, ''], [1, null]]) assert.equal(host.receive(p, key, b, 0), false);
  assert.equal(host.receive(1, 'key-1', host.packet(), 0), false, 'guest snapshots never enter simulation');
  assert.deepEqual(Arena.snapshot(host.state), before);
  assert.equal(host.receive(1, 'key-1', b, 0), true);
  host.step(0);
  assert.ok(host.state.actors[0].x > before.actors[0].x);
  assert.equal(host.state.actors[0].damage, 0); assert.equal(host.state.actors[0].stocks, 3);
  host.syncRoster([{ ...rows()[0], role: 1 }, rows()[1]], 10);
  assert.equal(host.receive(1, 'key-1', input(host, 2), 10), false, 'demotion revokes control');
});

test('duplicate, reordered, old-epoch, distant-sequence, and old/future-tick input is rejected', () => {
  const { host } = playing();
  assert.equal(host.receive(1, 'key-1', input(host, 2), 0), true);
  for (const b of [input(host, 0), input(host, 1), input(host, 2), input(host, 3603), input(host, 3, {}, [0, 0, 0], { epoch: host.epoch - 1 }), input(host, 3, {}, [0, 0, 0], { tick: host.state.tick - 121 }), input(host, 3, {}, [0, 0, 0], { tick: host.state.tick + 13 })]) assert.equal(host.receive(1, 'key-1', b, 1), false);
  assert.equal(host.receive(1, 'key-1', input(host, 3, {}, [0, 0, 0], { tick: host.state.tick - 120 }), 2), true, 'exact lower tick boundary');
  assert.equal(host.receive(1, 'key-1', input(host, 4, {}, [0, 0, 0], { tick: host.state.tick + 12 }), 3), true, 'exact upper tick boundary');
  assert.equal(host.seats[0].seq, 4);
});

test('per-seat token bucket bounds bursts and refills at 60 inputs per second', () => {
  const { host } = setup();
  for (let seq = 1; seq <= 12; seq++) assert.equal(host.receive(1, 'key-1', input(host, seq), 0), true);
  assert.equal(host.receive(1, 'key-1', input(host, 13), 0), false);
  assert.equal(host.receive(2, 'key-2', input(host, 1), 0), true, 'one guest cannot consume another seat budget');
  assert.equal(host.receive(1, 'key-1', input(host, 13), 16), false);
  assert.equal(host.receive(1, 'key-1', input(host, 13), 17), true);
  assert.equal(host.receive(1, 'key-1', input(host, 14), 17), false);
  assert.equal(host.receive(1, 'key-1', input(host, 14), 1000), true);
});

test('cumulative input edges survive replaceable packets and are consumed once', () => {
  const { host } = playing();
  assert.equal(host.receive(1, 'key-1', input(host, 1, { jumpHeld: true }, [1, 0, 0]), 0), true);
  assert.equal(host.receive(1, 'key-1', input(host, 2, { jumpHeld: true }, [1, 0, 0]), 0), true);
  host.step(0);
  assert.equal(host.state.actors[0].jumpCount, 1);
  assert.equal(host.state.events.filter(e => e.type === 'jump').length, 1);
  host.step(17);
  assert.equal(host.state.actors[0].jumpCount, 1, 'held command does not repeat an edge');
  assert.equal(host.receive(1, 'key-1', input(host, 4, { jumpHeld: true }, [2, 0, 0]), 34), true, 'latest packet carries a lost earlier edge');
  host.step(34);
  assert.equal(host.state.actors[0].jumpCount, 2);
  assert.equal(host.receive(1, 'key-1', input(host, 5, {}, [1, 0, 0]), 51), false, 'edge counters cannot move backward');
  assert.equal(host.receive(1, 'key-1', input(host, 5, {}, [4, 0, 0]), 51), false, 'cannot claim multiple new edges for one packet');
});

test('latest axes win independently of pending edges and expired input becomes neutral at 200 ms', () => {
  const { host } = playing();
  assert.equal(host.receive(1, 'key-1', input(host, 1, { moveX: 1 }, [0, 1, 0]), 0), true);
  assert.equal(host.receive(1, 'key-1', input(host, 2, { moveX: -1 }, [0, 1, 0]), 0), true);
  host.step(0);
  assert.equal(host.state.actors[0].attackSerial, 1);
  assert.equal(host.state.actors[0].attackDirX, -1);
  assert.ok(host.state.actors[0].vx < 0);
  const before = Arena.snapshot(host.state);
  const expected = Arena.restore(before);
  Arena.step(expected, {});
  host.step(201);
  assert.deepEqual(host.state.actors, expected.actors, 'stale directional and held input are neutral');
  const active = playing();
  active.host.receive(1, 'key-1', input(active.host, 1, { moveX: 1 }), 0);
  active.host.step(200);
  assert.ok(active.host.state.actors[0].vx > 0, '200 ms exact boundary still valid');
});

test('expired pending actions are discarded and cannot reappear after fresh neutral input', () => {
  const { host } = playing();
  host.receive(1, 'key-1', input(host, 1, {}, [1, 1, 1]), 0);
  host.step(201);
  assert.equal(host.state.actors[0].jumpCount, 0); assert.equal(host.state.actors[0].attackSerial, 0); assert.equal(host.state.actors[0].dashTicks, 0);
  host.receive(1, 'key-1', input(host, 2, {}, [1, 1, 1]), 202);
  host.step(202);
  assert.equal(host.state.actors[0].jumpCount, 0); assert.equal(host.state.actors[0].attackSerial, 0);
});

test('host owns exact pulse hits and serializes authoritative damage, stock losses, and winner', () => {
  const { host, client } = playing(), [a, b] = host.state.actors;
  place(a, 440, 420); place(b, 484, 420);
  assert.equal(host.receive(1, 'key-1', client.input({ attackPressed: true }, 1), 0), true);
  finishAttack(host);
  assert.equal(b.damage, 12); assert.equal(a.attackSerial, 1);
  let frame = client.accept(host.packet());
  assert.equal(frame.state.actors[1].damage, 12);
  assert.equal(frame.state.events.filter(e => e.type === 'hit').length, 1);
  b.stocks = 1; b.y = 900;
  host.step(500);
  assert.equal(b.stocks, 0); assert.equal(b.damage, 0); assert.equal(a.kos, 1);
  assert.deepEqual(host.state.result, { winnerIds: [1], winnerTeam: null, tie: false, reason: 'stocks' });
  frame = client.accept(host.packet());
  assert.deepEqual(frame.state.result, host.state.result);
  assert.equal(frame.state.actors[1].stocks, 0);
  assert.equal(client.input({ attackPressed: true }, 1), null);
  const frozen = Arena.snapshot(host.state);
  assert.equal(host.receive(1, 'key-1', input(host, 2), 501), false);
  host.step(999);
  assert.deepEqual(Arena.snapshot(host.state), frozen);
});

test('team input seat mapping keeps friendly fire off and names the full winning team', () => {
  const { host } = playing('teams');
  const [a, teammate, enemy, other] = host.state.actors;
  place(a, 440, 420); place(teammate, 484, 420); place(enemy, 490, 420); place(other, 700, 420);
  assert.equal(host.receive(1, 'key-1', input(host, 1, {}, [0, 1, 0]), 0), true);
  finishAttack(host);
  assert.equal(teammate.damage, 0); assert.equal(enemy.damage, 12);
  enemy.stocks = 1; other.stocks = 1; enemy.y = 900; other.y = 900;
  host.step(500);
  assert.deepEqual(host.state.result, { winnerIds: [1, 2], winnerTeam: 0, tie: false, reason: 'stocks' });
  assert.deepEqual(Online.decodeSnapshot(host.packet()).state.result, host.state.result);
});

test('timeout and simultaneous final-stock ties roundtrip without inventing a winner', () => {
  for (const format of ['duel', 'ffa', 'teams']) {
    const { host } = playing(format);
    host.state.timeLeftTicks = 1;
    host.step(0);
    assert.equal(host.state.result.tie, true); assert.equal(host.state.result.reason, 'time');
    assert.deepEqual(Online.decodeSnapshot(host.packet()).state.result, host.state.result);
    const other = playing(format).host;
    other.state.actors.forEach(a => { a.stocks = 1; a.y = 900; });
    other.step(0);
    assert.deepEqual(other.state.result, { winnerIds: [], winnerTeam: null, tie: true, reason: 'stocks' });
    assert.deepEqual(Online.decodeSnapshot(other.packet()).state.result, other.state.result);
  }
});

test('pause, resume, new round, and lobby increment epochs and flush latched inputs', () => {
  const { host, client } = playing();
  const stale = client.input({ jumpPressed: true, attackPressed: true, moveX: 1 }, 1);
  assert.equal(host.receive(1, 'key-1', stale, 0), true);
  const before = Arena.snapshot(host.state), originalEpoch = host.epoch;
  assert.equal(host.pause(true), true); assert.equal(host.epoch, originalEpoch + 1);
  assert.equal(host.pause(true), true); assert.equal(host.epoch, originalEpoch + 1, 'idempotent pause');
  host.step(900);
  assert.deepEqual(Arena.snapshot(host.state), before);
  assert.equal(host.receive(1, 'key-1', stale, 900), false);
  assert.equal(client.accept(host.packet()).status, 'paused'); assert.equal(client.input({}, 1), null);
  assert.equal(host.pause(false), true); assert.equal(host.epoch, originalEpoch + 2);
  assert.equal(host.receive(1, 'key-1', stale, 900), false);
  assert.ok(client.accept(host.packet()));
  assert.equal(Online.decodeInput(client.input({}, 1)).seq, 1);
  host.step(1000);
  assert.equal(host.state.actors[0].jumpCount, 0); assert.equal(host.state.actors[0].attackSerial, 0);
  host.lobby();
  assert.equal(host.epoch, originalEpoch + 3); assert.equal(host.state.tick, 0);
  assert.equal(client.accept(host.packet()).status, 'lobby'); assert.equal(client.input({}, 1), null);
  assert.equal(host.pause(true), false);
  host.start(7); assert.equal(host.epoch, originalEpoch + 4); assert.equal(host.state.phase, 'countdown');
  assert.ok(client.accept(host.packet())); assert.equal(Online.decodeInput(client.input({}, 1)).seq, 1);
});

test('clients require host sender, reject stale snapshots, and never regress their display', () => {
  const { host, client } = setup();
  const old = host.packet(); host.step(0); const fresh = host.packet();
  assert.equal(client.accept(fresh, 2), null);
  assert.ok(client.accept(fresh)); const saved = client.current;
  assert.equal(client.accept(old), null); assert.equal(client.accept(fresh), null);
  const lowerTick = clone(host.packet()); view(lowerTick).setUint32(10, 0, true);
  assert.equal(client.accept(lowerTick), null);
  const olderEpoch = clone(host.packet()); view(olderEpoch).setUint32(6, host.epoch - 1, true);
  assert.equal(client.accept(olderEpoch), null);
  assert.equal(client.current, saved);
  assert.equal(client.input({}, 99), null);
});

test('client event dedup survives overlapping snapshots and does not replay old effects after pause', () => {
  const { host, client } = playing();
  host.receive(1, 'key-1', input(host, 1, { jumpHeld: true }, [1, 0, 0]), 0); host.step(0);
  const first = client.accept(host.packet()); assert.equal(first.state.events.length, 1);
  const serial = first.state.events[0].serial;
  assert.equal(client.accept(host.packet()).state.events.length, 0);
  host.receive(1, 'key-1', input(host, 2, { jumpHeld: true }, [2, 0, 0]), 17); host.step(17);
  const second = client.accept(host.packet()); assert.equal(second.state.events.length, 1); assert.ok(second.state.events[0].serial > serial);
  host.pause(true); client.accept(host.packet()); host.pause(false); client.accept(host.packet());
  host.receive(1, 'key-1', input(host, 1, {}, [0, 1, 0]), 40); host.step(40);
  const third = client.accept(host.packet()); assert.equal(third.state.events.length, 1); assert.equal(third.state.events[0].type, 'attack');
});

test('snapshot render fields roundtrip, views honor offsets, and all generated frames stay below 500 bytes', () => {
  const { host } = playing('ffa', 0);
  let largest = 0;
  for (let tick = 0; tick < 1400 && host.state.phase !== 'over'; tick++) {
    host.step(tick * 1000 / 60);
    const b = host.packet(); largest = Math.max(largest, b.length);
    assert.ok(b.length <= 500, `${b.length} byte snapshot`);
    const decoded = Online.decodeSnapshot(b); assert.ok(decoded);
    assert.equal(decoded.state.tick, host.state.tick); assert.equal(decoded.state.phase, host.state.phase);
    for (const a of host.state.actors) {
      const d = decoded.state.actors[a.id - 1];
      for (const key of ['x', 'y', 'px', 'py', 'vx', 'vy']) assert.ok(Math.abs(d[key] - a[key]) < 0.001, `${key} quantization`);
      for (const key of ['id', 'team', 'profileId', 'damage', 'stocks', 'deaths', 'kos', 'stun', 'invulnerable', 'attackTicks', 'dashTicks', 'dashCooldown', 'respawnTicks', 'jumpCount', 'onGround', 'airDashAvailable', 'facing', 'attackSerial', 'lastHitBy']) assert.equal(d[key], a[key], key);
    }
    const padded = new Uint8Array(b.length + 11); padded.set(b, 5);
    assert.deepEqual(Online.decodeSnapshot(padded.subarray(5, 5 + b.length)), decoded);
    assert.deepEqual(Online.decodeSnapshot(Buffer.from(b)), decoded);
  }
  assert.ok(largest > 450, 'exercise a full overlapping event history');
});

test('snapshot decoder rejects invalid container types, every truncation, and trailing bytes', () => {
  const { host } = setup('ffa'), b = host.packet();
  for (const invalid of [null, undefined, {}, [], [...b], b.buffer, new DataView(b.buffer), new Int8Array(b)]) assert.equal(Online.decodeSnapshot(invalid), null);
  for (let n = 0; n < b.length; n++) assert.equal(Online.decodeSnapshot(b.subarray(0, n)), null, `truncation ${n}`);
  const extra = new Uint8Array(b.length + 1); extra.set(b); assert.equal(Online.decodeSnapshot(extra), null);
  assert.equal(Online.decodeSnapshot(new Uint8Array(Online.MAX_BYTES + 1)), null);
});

test('snapshot decoder rejects malformed headers, actor identities, nonfinite positions and impossible gameplay ranges', () => {
  const { host } = setup('ffa'), b = host.packet(), size = actorBytes(b);
  for (const [offset, value] of [[0, 0], [1, 1], [14, 255], [15, 255], [16, 255], [17, 3], [18, 3], [23, 3], [24, 16], [25, 255], [26, 13], [HEADER, 2], [HEADER + 1, 49], [HEADER + 2, 2], [HEADER + 33, 4], [HEADER + 38, C.ATTACK_TICKS + 1], [HEADER + 39, C.DASH_TICKS + 1], [HEADER + 42, 3], [HEADER + 47, 8], [HEADER + 52, 5]]) {
    const bad = clone(b); bad[offset] = value; assert.equal(Online.decodeSnapshot(bad), null, `byte ${offset} = ${value}`);
  }
  let bad = clone(b); bad[HEADER + size + 1] = bad[HEADER + 1]; assert.equal(Online.decodeSnapshot(bad), null, 'duplicate player slot');
  for (const value of [NaN, Infinity, -Infinity, 8193, -8193]) for (let f = 0; f < 6; f++) {
    bad = clone(b); view(bad).setFloat32(HEADER + 7 + f * 4, value, true); assert.equal(Online.decodeSnapshot(bad), null, `${value} actor float ${f}`);
  }
  for (const [offset, value] of [[19, C.COUNTDOWN_TICKS + 1], [21, C.MATCH_TICKS + 1], [HEADER + 31, 1000]]) {
    bad = clone(b); view(bad).setUint16(offset, value, true); assert.equal(Online.decodeSnapshot(bad), null);
  }
  bad = clone(b); view(bad).setUint32(10, 60 * 60 * 24 + 1, true); assert.equal(Online.decodeSnapshot(bad), null);
  bad = clone(b); bad[18] = 2; assert.equal(Online.decodeSnapshot(bad), null, 'over requires result');
  bad = clone(b); bad[25] = 1; assert.equal(Online.decodeSnapshot(bad), null, 'result requires over');
});

test('snapshot decoder rejects malformed event types, IDs, order, and nonfinite coordinates', () => {
  const { host } = playing();
  host.receive(1, 'key-1', input(host, 1, { jumpHeld: true }, [1, 1, 0]), 0); host.step(0);
  const b = host.packet(), start = HEADER + actorBytes(b) * b[23];
  assert.ok(b[26] >= 2);
  for (const [offset, value] of [[start + 4, 255], [start + 5, 5], [start + 6, 5]]) {
    const bad = clone(b); bad[offset] = value; assert.equal(Online.decodeSnapshot(bad), null);
  }
  for (const value of [NaN, Infinity, -Infinity, 8193]) for (const offset of [start + 7, start + 11]) {
    const bad = clone(b); view(bad).setFloat32(offset, value, true); assert.equal(Online.decodeSnapshot(bad), null);
  }
  const bad = clone(b); view(bad).setUint32(start + EVENT, view(bad).getUint32(start, true), true);
  assert.equal(Online.decodeSnapshot(bad), null, 'serials must strictly increase');
});

test('every one-byte snapshot mutation is rejected or yields finite bounded display data', () => {
  const { host } = playing('teams'), b = host.packet();
  for (let offset = 0; offset < b.length; offset++) for (const value of [0, 127, 128, 255]) {
    const mutated = clone(b); mutated[offset] = value;
    const d = Online.decodeSnapshot(mutated);
    if (!d) continue;
    for (const a of d.state.actors) {
      for (const key of ['x', 'y', 'px', 'py', 'vx', 'vy', 'attackDirX', 'attackDirY']) assert.ok(Number.isFinite(a[key]), `offset ${offset}, ${key}`);
      assert.ok(a.damage >= 0 && a.damage <= 999); assert.ok(a.stocks >= 0 && a.stocks <= 3);
    }
  }
});

test('disconnect immediately clears latched input and only the exact identity may rejoin', () => {
  const { host } = playing();
  host.receive(1, 'key-1', input(host, 1, { moveX: 1 }, [1, 1, 0]), 0);
  host.syncRoster([rows()[1]], 10);
  host.step(10);
  assert.equal(host.seats[0].connected, false); assert.equal(host.state.actors[0].attackSerial, 0); assert.equal(host.state.actors[0].jumpCount, 0);
  host.syncRoster([{ p: 1, role: 0, identity: 'new-key' }, rows()[1]], 20);
  assert.equal(host.seats[0].connected, false);
  assert.equal(host.receive(1, 'new-key', input(host, 2), 20), false);
  host.syncRoster(rows(), 30);
  assert.equal(host.seats[0].connected, true);
  assert.equal(host.receive(1, 'key-1', input(host, 2, {}, [1, 1, 0]), 30), true);
  host.step(30);
  assert.equal(host.state.actors[0].attackSerial, 0, 'old pending edges cannot survive reconnect');
});

test('disconnect grace expires exactly at 10 seconds and eliminated actors never regain stocks', () => {
  const { host, client } = playing('ffa');
  host.syncRoster(rows(4).slice(1), 100);
  host.step(100 + Online.REJOIN_MS - 1);
  assert.equal(host.state.actors[0].stocks, 3);
  host.step(100 + Online.REJOIN_MS);
  assert.equal(host.state.actors[0].stocks, 0);
  assert.equal(host.state.phase, 'playing');
  assert.equal(client.accept(host.packet()).seats.find(s => s.p === 1).connected, false);
  host.syncRoster(rows(4), 10200);
  host.step(10200);
  assert.equal(host.state.actors[0].stocks, 0);
  assert.equal(host.state.actors[0].controller, 'human', 'forfeited human is never replaced by a CPU');
});

test('lobby resets a departed slot for its new identity only for the next match', () => {
  const { host } = playing();
  const changed = [{ p: 1, role: 0, identity: 'replacement' }, rows()[1]];
  host.syncRoster(changed, 10);
  assert.equal(host.receive(1, 'replacement', input(host), 10), false);
  host.lobby(); host.start(3);
  assert.equal(host.receive(1, 'key-1', input(host), 11), false);
  assert.equal(host.receive(1, 'replacement', input(host), 11), true);
  assert.equal(host.state.actors[0].stocks, 3);
});

// Regressions discovered during adversarial review. These intentionally assert
// the required behavior rather than blessing a broken reconnect or wire frame.
test('duplicate roster entries cannot create an undecodable authority snapshot', () => {
  const host = Online.createHost({ format: 'ffa' });
  host.syncRoster([rows()[0], rows()[0], rows()[1]], 0);
  assert.equal(new Set(host.seats.map(s => s.p)).size, host.seats.length);
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('same-identity reconnect with a fresh client can resume after previously accepted edges', () => {
  const { host } = playing('ffa');
  for (let seq = 1; seq <= 4; seq++) assert.equal(host.receive(1, 'key-1', input(host, seq, {}, [seq, seq, seq]), seq * 20), true);
  host.syncRoster(rows(4).slice(1), 100);
  host.syncRoster(rows(4), 200);
  const replacement = Online.createClient();
  assert.ok(replacement.accept(host.packet()));
  const command = replacement.input({ moveX: 1 }, 1);
  assert.ok(command);
  assert.equal(host.receive(1, 'key-1', command, 201), true, 'acknowledged sequence and cumulative edges must restore control');
  host.step(201);
  assert.equal(host.state.actors[0].jumpCount, 0, 'acknowledged edges must not replay');
  assert.equal(host.state.actors[0].attackSerial, 0);
});

test('reconnecting after the grace deadline cannot evade a forfeit between host ticks', () => {
  const { host } = playing('ffa');
  host.syncRoster(rows(4).slice(1), 100);
  host.syncRoster(rows(4), 100 + Online.REJOIN_MS + 1);
  host.step(100 + Online.REJOIN_MS + 1);
  assert.equal(host.state.actors[0].stocks, 0, 'deadline is checked before reconnect clears disconnectedAt');
});

test('bounded multi-second sequence gaps accept the latest command without replaying every missed edge', () => {
  const { host } = playing();
  assert.equal(host.receive(1, 'key-1', input(host, 1), 0), true);
  assert.equal(host.receive(1, 'key-1', input(host, 601, { moveX: 1 }, [3, 4, 2]), 100), true);
  host.step(100);
  assert.ok(host.state.actors[0].jumpCount <= 1);
  assert.ok(host.state.actors[0].attackSerial <= 1);
  assert.equal(host.seats[0].seq, 601);
  const fresh = Online.createClient(); fresh.accept(host.packet());
  const next = Online.decodeInput(fresh.input({}, 1));
  assert.equal(next.seq, 602); assert.deepEqual(next.edges, [3, 4, 2]);
});

test('countdown input edges are not deferred into the live round', () => {
  const { host } = setup();
  host.receive(1, 'key-1', input(host, 1, { jumpHeld: true }, [1, 1, 1]), 0);
  host.step(0);
  for (let i = 1; i <= C.COUNTDOWN_TICKS; i++) host.step(i * 1000 / 60);
  assert.equal(host.state.phase, 'playing');
  assert.equal(host.state.actors[0].jumpCount, 0); assert.equal(host.state.actors[0].attackSerial, 0); assert.equal(host.state.actors[0].dashTicks, 0);
});

test('same-identity reconnect expiry remains enforced across a paused match', () => {
  const { host } = playing('ffa');
  host.syncRoster(rows(4).slice(1), 100);
  host.pause(true);
  const tick = host.state.tick;
  host.step(20000); assert.equal(host.state.tick, tick);
  host.syncRoster(rows(4), 20000);
  assert.equal(host.state.actors[0].stocks, 0);
  host.pause(false); host.step(20001);
  assert.equal(host.state.actors[0].stocks, 0);
});

test('duplicate identity cannot occupy two human actor seats', () => {
  const host = Online.createHost({ format: 'ffa' });
  host.syncRoster([rows()[0], { p: 2, role: 0, identity: 'key-1' }, { p: 3, role: 0, identity: 'key-3' }], 0);
  assert.equal(new Set(host.seats.map(s => s.identity)).size, host.seats.length);
  assert.ok(Online.decodeSnapshot(host.packet()));
});

test('a finished match keeps its final scoring state despite later disconnected-seat expiry', () => {
  const { host } = playing();
  host.syncRoster([rows()[1]], 100);
  host.state.timeLeftTicks = 1;
  host.state.actors[1].damage = 10;
  host.step(101);
  assert.equal(host.state.phase, 'over'); assert.deepEqual(host.state.result.winnerIds, [1]);
  const finished = Arena.snapshot(host.state);
  host.syncRoster([rows()[1]], 100 + Online.REJOIN_MS + 1);
  assert.deepEqual(Arena.snapshot(host.state), finished);
});

test('host team selection swaps full sides and stays fixed throughout combat',()=>{
  const h=Online.createHost({format:'teams'});h.syncRoster(rows(4),0);
  const teams=()=>h.seats.map(s=>[s.p,h.state.actors[s.actorId-1].team]);
  assert.deepEqual(teams(),[[1,0],[2,1],[3,0],[4,1]]);assert.equal(h.setTeam(2,0),true);
  assert.deepEqual(teams(),[[1,0],[2,0],[3,1],[4,1]]);h.syncRoster(rows(4).reverse(),1);h.start(9);
  assert.deepEqual(teams(),[[1,0],[2,0],[3,1],[4,1]]);assert.equal(h.setTeam(2,1),false);
  h.lobby();assert.equal(h.setTeam(2,1),true);assert.equal(new Set(h.seats.map(s=>s.actorId)).size,4);
});
