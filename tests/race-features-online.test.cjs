const test = require('node:test'), assert = require('node:assert/strict');
const Race = require('../src/race.js'), O = require('../src/race-online.js');
const J = require('../src/journey-online.js'), Expedition = require('../src/expedition.js');
const rows = Array.from({ length: 4 }, (_, i) => ({ p: i + 1, identity: i ? 'peer-' + (i + 1) : 'host', role: 0 }));
const time = h => h.state.tick * 1000 / 60;
function setup() {
  const h = O.createHost(); h.syncRoster(rows, 0); h.start();
  for (let n = 0; n < Race.constants.COUNTDOWN; n++) h.step(time(h));
  const c = O.createClient(); c.accept(h.packet(), 1); c.input({}, 2);
  return { h, c };
}
function effect(h, owner = 0, serial = 1) {
  h.state.actors[owner].pulseSerial = serial;
  const e = { ownerId: 'pilot-' + owner, serial, phase: 'charge', age: 0, s: 0, d: 0, originS: 0, observedAt: Array(5).fill(-1) };
  h.state.effects.push(e); return e;
}
function input(h, seq, extra = {}) {
  return O.encodeInput({ epoch: h.epoch, tick: h.state.tick, seq, recoverEdges: 0, itemEdges: 0, command: {}, ...extra });
}

test('v2 carries bounded full actor/effect state and reaches only 648 bytes / 682 wrapped at the absolute maximum', () => {
  const { h } = setup();
  for (let i = 0; i < 5; i++) {
    const a = h.state.actors[i];
    Object.assign(a, { item: i % 2 ? 'shield' : 'pulse', coinMask: 1023, rowMask: 3, rampMask: 3,
      airRamp: 2, airTicks: 15, z: 29, shieldTicks: 240, slowTicks: 24, immunityTicks: 90 });
    const e = effect(h, i, 65535); Object.assign(e, { phase: 'wave', age: 27, originS: 100, s: 424, d: i % 2 ? -44 : 44 });
  }
  const host = { state: h.state, seats: h.seats, revision: 2, epoch: h.epoch, now: time(h), status: 'running',
    events: Array.from({ length: 12 }, (_, i) => ({ serial: i + 1, type: 'coin', id: 'pilot-' + (i % 5) })) };
  const b = O.encodeSnapshot(host), d = O.decodeSnapshot(b);
  assert.equal(O.VERSION, 2); assert.equal(O.CATALOG_VERSION, 1); assert.equal(b.length, 648); assert.ok(d);
  assert.equal(d.state.effects.length, 5); assert.equal(d.state.actors[0].coinMask, 1023);
  assert.equal(d.state.actors[0].z, 29); assert.equal(d.state.actors[0].pulseSerial, 65535);
  assert.equal(d.state.effects[0].observedAt, undefined, 'receipt clocks stay host-only');
  d.state.effects[0].s++; assert.equal(h.state.effects[0].s, 424, 'detached effects');
  let seed = 1; while (Expedition.encounterAt(seed, 0).id !== 'race') seed++;
  const outer = J.encode({ session: 1, epoch: 1, index: 0, seed, revision: 1, tick: 0, players: 15,
    type: J.SNAPSHOT, mode: 'race', phase: 'running' }, b);
  assert.equal(J.VERSION, 2); assert.equal(outer.length, 682); assert.ok(J.decode(outer));
  const old = b.slice(); old[0] = 1; assert.equal(O.decodeSnapshot(old), null);
  const oldOuter = outer.slice(); oldOuter[0] = 1; assert.equal(J.decode(oldOuter), null);
  host.state.effects.push({ ...host.state.effects[0] }); assert.equal(O.encodeSnapshot(host), null);
});

test('unknown catalogs, impossible item/air/effect values, duplicate owners and all truncations fail closed', () => {
  const { h } = setup(); effect(h); effect(h, 1); const bytes = h.packet(), H = O.HEADER_BYTES, E = H + 5 * O.ACTOR_BYTES;
  const mutations = [b => b[29] = 0, b => b[31] = 1, b => b[30] = 6, b => b[H + 64] = 3,
    b => b[H + 66] = 4, b => b[H + 67] = 4, b => b[H + 68] = 4, b => b[H + 69] = 3,
    b => b[H + 70] = 30, b => b[H + 75] = 241, b => b[H + 76] = 25, b => b[H + 77] = 91,
    b => b[H + 80] = 1, b => b[H + 82] = 1, b => b[H + 83] = 1,
    b => b[E] = 5, b => b[E + 1] = 0, b => b[E + 3] = 2, b => b[E + 4] = 54,
    b => b[E + 5] = 1, b => b[E + 20] = 0, b => { b[E + 3] = 1; b[E + 4] = 28; }];
  for (const edit of mutations) { const b = bytes.slice(); edit(b); assert.equal(O.decodeSnapshot(b), null); }
  for (const offset of [H + 71, E + 8, E + 12, E + 16]) for (const n of [NaN, Infinity, -Infinity, 1e9]) {
    const b = bytes.slice(); new DataView(b.buffer).setFloat32(offset, n, true); assert.equal(O.decodeSnapshot(b), null);
  }
  for (let n = 0; n < bytes.length; n++) assert.equal(O.decodeSnapshot(bytes.subarray(0, n)), null);
});

test('authenticated monotonic Item edges survive lost presses, coalesce bursts and never replay on held input/pickup', () => {
  const { h, c } = setup(), a = h.state.actors[1]; a.item = 'shield'; c.accept(h.packet(), 1);
  const lost = c.input({ item: true }, 2), held = c.input({ item: true }, 2);
  assert.equal(O.decodeInput(lost).itemEdges, 1); assert.equal(O.decodeInput(held).itemEdges, 1);
  assert.equal(h.receive(2, 'peer-3', held, time(h)), false); assert.equal(h.receive(2, 'peer-2', held, time(h)), true);
  h.step(time(h)); assert.equal(a.item, null); assert.equal(a.shieldTicks, 240);
  a.item = 'shield'; assert.equal(h.receive(2, 'peer-2', lost, time(h)), false);
  h.receive(2, 'peer-2', c.input({ item: true }, 2), time(h)); h.step(time(h)); assert.equal(a.item, 'shield');
  c.input({}, 2); const one = c.input({ item: true }, 2); c.input({}, 2); const two = c.input({ item: true }, 2);
  assert.ok(h.receive(2, 'peer-2', one, time(h))); assert.ok(h.receive(2, 'peer-2', two, time(h)));
  h.step(time(h)); assert.equal(a.shieldTicks, 240); assert.equal(a.item, null);
  a.item = 'shield'; h.step(time(h)); assert.equal(a.item, 'shield', 'coalesced edges never bank an extra activation');
});

test('stale, release, epoch and identity rejoin flush pending Item and displayed warning state', () => {
  const { h, c } = setup(), a = h.state.actors[1], e = effect(h); a.item = 'shield'; c.accept(h.packet(), 1);
  c.observeWarnings([1, 0, 0, 0, 0]); const press = c.input({ item: true }, 2);
  assert.ok(h.receive(2, 'peer-2', press, time(h))); const first = time(h);
  assert.equal(e.observedAt[1], h.state.raceTick); assert.equal(e.observedAt[0], -1);
  h.step(first + O.INPUT_TTL_MS); assert.equal(a.item, 'shield'); assert.equal(e.observedAt[1], -1);
  assert.ok(h.receive(2, 'peer-2', c.release(2), first + O.INPUT_TTL_MS + 1));
  const held = O.decodeInput(c.input({ item: true }, 2)); assert.equal(held.itemEdges, 1); assert.deepEqual(held.warnings, [0, 0, 0, 0, 0]);
  h.pause(true); const frozen = JSON.stringify(h.state); h.step(first + 1000); assert.equal(JSON.stringify(h.state), frozen);
  h.pause(false); assert.equal(e.observedAt[1], -1); assert.equal(h.receive(2, 'peer-2', press, first + 1001), false);
  c.accept(h.packet(), 1); assert.equal(O.decodeInput(c.input({ item: true }, 2)).itemEdges, 0, 'held through epoch is suppressed');
  c.input({}, 2); const fresh = c.input({ item: true }, 2); assert.equal(O.decodeInput(fresh).itemEdges, 1);
  h.syncRoster(rows.filter(r => r.p !== 2), first + 1002); h.syncRoster(rows.map(r => r.p === 2 ? { ...r, p: 7 } : r), first + 1003);
  assert.equal(h.receive(2, 'peer-2', fresh, first + 1004), false);
  c.accept(h.packet(), 1); assert.equal(O.decodeInput(c.input({ item: true }, 7)).itemEdges, 0);
});

test('warning receipt needs explicit display, affects only submitting pilot and is never minted by unknown serials', () => {
  const { h, c } = setup(), e = effect(h); c.accept(h.packet(), 1);
  assert.deepEqual(O.decodeInput(c.input({ warnings: [1, 0, 0, 0, 0] }, 2)).warnings, [0, 0, 0, 0, 0]);
  c.observeWarnings([999, 0, 0, 0, 0]); assert.deepEqual(O.decodeInput(c.input({}, 2)).warnings, [0, 0, 0, 0, 0]);
  c.observeWarnings([1, 0, 0, 0, 0]); assert.ok(h.receive(2, 'peer-2', c.input({}, 2), time(h)));
  assert.deepEqual(e.observedAt, [-1, h.state.raceTick, -1, -1, -1]);
  const receipt = e.observedAt[1]; h.step(time(h));
  assert.ok(h.receive(2, 'peer-2', c.input({}, 2), time(h))); assert.equal(e.observedAt[1], receipt, 'neutral controls do not continually reset warning delay');
  h.receive(2, 'peer-2', c.release(2), time(h)); assert.equal(e.observedAt[1], -1);
  c.observeWarnings([1, 0, 0, 0, 0]); h.receive(2, 'peer-2', c.input({}, 2), time(h));
  assert.equal(e.observedAt[1], h.state.raceTick, 'menu return begins a new 600 ms window');
  h.state.effects = []; c.accept(h.packet(), 1); assert.deepEqual(O.decodeInput(c.input({}, 2)).warnings, [0, 0, 0, 0, 0]);
  assert.equal(h.state.effects.length, 0);
});

test('invalid and saturated counters are bounded; input cannot carry inventory, trajectory or victim identity', () => {
  const { h } = setup();
  for (const extra of [{ itemEdges: 2 }, { itemEdges: -1 }, { itemEdges: 65536 }, { warnings: [1] }, { warnings: [0, 0, 0, 0, NaN] }]) {
    const b = input(h, 1, extra); assert.equal(b ? h.receive(1, 'host', b, time(h)) : false, false);
  }
  assert.equal(O.INPUT_BYTES, 33);
  const b = input(h, 1, { command: { item: 'pulse', itemEdge: 42, z: 100, coinMask: 1023, hits: ['pilot-1'], target: 'pilot-1' } });
  assert.ok(h.receive(1, 'host', b, time(h))); h.step(time(h)); assert.equal(h.state.effects.length, 0); assert.equal(h.state.actors[0].item, null);
  const c = O.createClient(); h.seats[1].seq = 65535; h.seats[1].itemEdges = 65535; c.accept(h.packet(), 1);
  c.input({}, 2); assert.equal(O.decodeInput(c.input({ item: true }, 2)).itemEdges, 65535, 'saturation never wraps');
});

test('seeded binary fuzz never throws or yields unbounded states', () => {
  const { h } = setup(); effect(h); const base = h.packet(); let seed = 0x8123812;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 8000; i++) {
    const b = i % 2 ? base.slice() : new Uint8Array(random() % 1100);
    for (let k = 0; k < 1 + random() % 5; k++) if (b.length) b[random() % b.length] = random() & 255;
    const d = O.decodeSnapshot(b); O.decodeInput(b); J.decode(b);
    if (d) { assert.equal(d.state.actors.length, 5); assert.ok(d.state.effects.length <= 5); assert.ok(b.length <= 990); }
  }
});

test('lost menu-release packet is recovered by the cumulative interruption generation before any fresh warning window', () => {
  const { h, c } = setup(), e = effect(h), a = h.state.actors[1]; c.accept(h.packet(), 1);
  c.observeWarnings([1, 0, 0, 0, 0]); h.receive(2, 'peer-2', c.input({}, 2), time(h));
  const firstReceipt = e.observedAt[1]; h.step(time(h));
  a.item = 'shield'; const lostPress = c.input({ item: true }, 2), lostRelease = c.release(2);
  assert.equal(O.decodeInput(lostPress).itemEdges, 1); assert.equal(O.decodeInput(lostRelease).releaseEdges, 1);
  c.observeWarnings([1, 0, 0, 0, 0]); const returned = c.input({}, 2);
  assert.ok(h.receive(2, 'peer-2', returned, time(h)));
  assert.equal(e.observedAt[1], h.state.raceTick); assert.ok(e.observedAt[1] > firstReceipt);
  assert.equal(h.seats[1].pendingItem, 0, 'lost pre-menu Item press is consumed without activation');
  h.step(time(h)); assert.equal(a.item, 'shield');
  assert.equal(h.receive(2, 'peer-2', lostRelease, time(h)), false, 'reordered release cannot overwrite resumed controls');
});

test('wire observation permits a hit only after 36 further host ticks; a missing or late observation cannot hit retrospectively', () => {
  for (const delay of [35, 36, null]) {
    const { h, c } = setup(), victim = h.state.actors[1];
    const track = Race.course('starlight'), point = Race.at(track, 200);
    Object.assign(victim, { x: point.x, y: point.y, heading: Math.atan2(point.ty, point.tx), vx: point.tx * 4, vy: point.ty * 4, speed: 4, passed: 1, nextGate: 2, lap: 1, progress: 1.04 });
    const e = effect(h); c.accept(h.packet(), 1);
    if (delay !== null) { c.observeWarnings([1, 0, 0, 0, 0]); assert.ok(h.receive(2, 'peer-2', c.input({}, 2), time(h))); }
    // Place the first wave sweep directly through the victim. Only the host's
    // receipt clock, not proximity or supplied trajectory, controls eligibility.
    h.state.raceTick = (delay === null ? 100 : delay) - 1; h.state.tick = Race.constants.COUNTDOWN + h.state.raceTick;
    Object.assign(e, { phase: 'wave', age: 0, originS: 195, s: 195 });
    const at = time(h); if (delay !== null) h.seats[1].receivedAt = at; // keep normal driving freshness independent of the tested warning clock
    h.step(at);
    assert.equal(victim.slowTicks > 0, delay === 36, `delay ${delay}`);
    if (delay === null) {
      h.state.effects = []; c.accept(h.packet(), 1); c.observeWarnings([1, 0, 0, 0, 0]);
      h.receive(2, 'peer-2', c.input({}, 2), time(h)); h.step(time(h)); assert.equal(victim.slowTicks, 0);
    }
  }
});

test('journey forwards display/release through its race adapter and destroys effects at the encounter boundary', () => {
  let seed = 1; while (Expedition.encounterAt(seed, 0).id !== 'race' || Expedition.encounterAt(seed, 0).trackId !== 'starlight') seed++;
  const host = J.createHost({ seed, session: 42 }), clients = rows.map(() => J.createClient());
  host.syncRoster(rows, 0); host.start(0); let packet = host.packet();
  clients.forEach((c, i) => { c.accept(packet, 1); host.receive(i + 1, rows[i].identity, c.ready(), 0); });
  host.step(J.MIN_BARRIER_MS);
  for (let n = 0; n < Race.constants.COUNTDOWN; n++) host.step(J.MIN_BARRIER_MS + (n + 1) * 1000 / 60);
  const inner = host.engine, e = effect(inner); packet = host.packet(); clients.forEach(c => c.accept(packet, 1));
  const c = clients[1]; c.input({}, 2); c.observeWarnings([1, 0, 0, 0, 0]); const at = 4000;
  assert.ok(host.receive(2, 'peer-2', c.input({}, 2), at)); assert.equal(e.observedAt[1], inner.state.raceTick);
  const released = c.release(2), r = O.decodeInput(J.decode(released).payload);
  assert.equal(r.released, true); assert.equal(r.releaseEdges, 1); assert.ok(host.receive(2, 'peer-2', released, at + 1));
  assert.equal(e.observedAt[1], -1); const old = c.input({}, 2);
  inner.state.phase = 'finished'; host.step(at + 2); assert.equal(host.engine, null); assert.equal(host.phase, 'barrier');
  c.accept(host.packet(), 1); assert.equal(c.observeWarnings([1, 0, 0, 0, 0]), false); assert.equal(c.input({}, 2), null);
  assert.equal(host.receive(2, 'peer-2', old, at + 3), false);
});

for (const trackId of ['ember', 'bloom']) test(`${trackId} rejects nonempty feature snapshots including in-range hit immunity`, () => {
  const host = O.createHost({ trackId }); host.syncRoster(rows, 0); host.start();
  const packet = host.packet(); assert.ok(O.decodeSnapshot(packet));
  // Each field is independently nonzero but otherwise within its global bound.
  // Check every pilot so the featureless guard cannot accidentally depend on role.
  for (let actor = 0; actor < O.PILOTS; actor++) {
    const base = O.HEADER_BYTES + actor * O.ACTOR_BYTES;
    for (const [offset, value] of [[64, 1], [65, 1], [67, 1], [68, 1], [75, 1], [76, 1], [77, 1], [77, 90], [78, 1]]) {
      const malformed = packet.slice(); malformed[base + offset] = value;
      assert.equal(O.decodeSnapshot(malformed), null, `pilot-${actor} feature byte ${offset}=${value}`);
    }
  }
});
