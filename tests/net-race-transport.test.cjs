// Race's transport is an opaque, bounded, authenticated mode on the existing
// relay. These tests exchange real encrypted packets, not transport mocks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { client, relay, until } = require('./harness.cjs');

async function room(t, { spectators = 0, players = 1, mode = 'race', ...opts } = {}) {
  const hub = relay(), host = client(hub, { game: false }), guests = [];
  t.after(() => { host.close(); guests.forEach((g) => g.close()); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, mode, ...opts });
  const invite = host.net.info().link.split('#j=')[1];
  async function join(role = 0) {
    const guest = client(hub, { game: false }); guests.push(guest);
    await guest.net.acceptJoin(invite, { mode, role });
    await until(() => guest.net.roster().some((r) => r.you), 'own authoritative roster');
    return guest;
  }
  for (let i = 0; i < players; i++) await join();
  for (let i = 0; i < spectators; i++) await join(1);
  await until(() => guests.every((g) => g.net.roster().length === guests.length + 1), 'complete race roster');
  return { hub, host, guests, invite, join, hs: host.net._n1.session() };
}
function collect(net, name = 'race-data') {
  const events = []; const off = net.onEvent(name, (d) => events.push(d));
  return { events, off };
}
function bytes(n, marker = 1) { return Uint8Array.from({ length: n }, (_, i) => (i + marker) & 255); }
async function fromGuest(host, guest, plain) {
  const gs = guest.net._n1.session();
  await host.net._n1.session()._onPacket(gs.keys.pub, await guest.net._n1.env.sealApp(gs.pair, plain));
}
async function fromHost(host, guest, plain) {
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  const row = hs.roster.get(host.net._n1.bytes.hex(gs.keys.pub));
  await gs._onPacket(hs.keys.pub, await host.net._n1.env.sealApp(row.pair, plain));
}

test('race mode is explicit; runner codecs stay protocol-6 byte compatible', async (t) => {
  const { host, guests, invite } = await room(t);
  const [guest] = guests, F = host.net._n1.frames, H = host.net._room.race;
  assert.equal(host.net.info().mode, 'race'); assert.equal(guest.net.info().mode, 'race');
  assert.equal(host.net.info().cap, 4); assert.equal(host.net.info().specCap, 4);
  assert.equal(host.net.peekInvite(invite).mode, 'race');
  assert.equal(host.net._n1.invite.decodeInvite(invite).inv.flags & H.INV_RACE, H.INV_RACE);
  assert.equal(host.net.resumeToken(), null); assert.equal(guest.net.resumeToken(), null);
  const hello = F.encHello(F.makeScratch(), { tag: 'ABC', suit: 0, hat: 0, wantP: 0, proof16: new Uint8Array(16) });
  assert.equal(hello.length, 43); assert.equal(F.decHello(hello).mode, 0);
  assert.equal(F.decHello(hello).caps, host.net._room.CAPS);
  const welcome = F.encWelcome(F.makeScratch(), { yourP: 2, seed: 1, runId: 1, hostTag: 'ABC' });
  assert.equal(welcome.length, 23); assert.deepEqual([...welcome.slice(20)], [0, 0, 0]);
  assert.equal(host.net._n1.PROTO, 6); assert.equal(host.net._n1.WIRE_MAX, 256);
});

test('race admits friends and viewers, authenticates identity, broadcasts and targets opaque data', async (t) => {
  const { host, guests } = await room(t, { players: 2, spectators: 1 });
  const [a, b, spectator] = guests, hostRx = collect(host.net), all = guests.map((g) => collect(g.net));
  const input = bytes(18, 99); assert.equal(await a.net.sendRace(input), true);
  await until(() => hostRx.events.length === 1, 'authenticated input');
  assert.equal(hostRx.events[0].p, a.net.info().myP);
  assert.equal(hostRx.events[0].pubHex, a.net._n1.bytes.hex(a.net._n1.session().keys.pub));
  assert.deepEqual(hostRx.events[0].bytes, input);
  const snapshot = bytes(700, 12); assert.equal(await host.net.sendRace(snapshot), true);
  await until(() => all.every((x) => x.events.length === 1), 'fragmented snapshot to all');
  all.forEach((x) => { assert.equal(x.events[0].p, 1); assert.deepEqual(x.events[0].bytes, snapshot); });
  assert.equal(await host.net.sendRace(bytes(1024, 21), b.net.info().myP), true);
  await until(() => all[1].events.length === 2, 'targeted snapshot');
  assert.equal(all[0].events.length, 1); assert.equal(all[2].events.length, 1);
  assert.equal(await a.net.sendRace(input, b.net.info().myP), false, 'guests cannot target another guest');
  assert.equal(await spectator.net.sendRace(input), false, 'spectators cannot send app commands');
  hostRx.off(); await a.net.sendRace(bytes(18));
  await new Promise((r) => setTimeout(r, 30)); assert.equal(hostRx.events.length, 1, 'typed unsubscribe works');
  let calls = 0; const off = host.net.onEvent((e) => { if (e === 'race-data') calls++; }); off();
  await a.net.sendRace(input); await new Promise((r) => setTimeout(r, 30)); assert.equal(calls, 0, 'existing callback unsubscribe works');
});

test('spectator bypass attempts are refused after decryption; guests cannot forge a different peer', async (t) => {
  const { host, guests, hs } = await room(t, { spectators: 1 });
  const [player, spectator] = guests, rx = collect(host.net), F = host.net._room.race;
  const data = F.raceFragment(bytes(18), 1, 0);
  await fromGuest(host, spectator, data);
  const spectatorRow = [...hs.roster.values()].find((r) => r.role === 1);
  assert.equal(spectatorRow.strikes, 1); assert.equal(rx.events.length, 0);
  const playerRx = collect(player.net), playerSession = player.net._n1.session();
  const wrongPub = spectator.net._n1.session().keys.pub;
  const row = hs.roster.get(host.net._n1.bytes.hex(playerSession.keys.pub));
  const wire = await host.net._n1.env.sealApp(row.pair, data);
  await playerSession._onPacket(wrongPub, wire);
  assert.equal(playerRx.events.length, 0, 'only host public key is accepted by guest');
  await playerSession._onPacket(hs.keys.pub, wire);
  assert.equal(playerRx.events.length, 1); assert.equal(playerRx.events[0].p, 1);
});

test('invite and HELLO gates reject old/new runner mixing and capability-only race claims', async (t) => {
  const { hub, host, invite, hs } = await room(t, { players: 0 });
  const runner = client(hub, { game: false }), other = client(hub, { game: false }), arena = client(hub, { game: false });
  t.after(() => { runner.close(); other.close(); arena.close(); });
  await assert.rejects(runner.net.acceptJoin(invite), /different game mode/i);
  assert.equal(runner.net._n1.session(), null, 'mismatch rejected before connecting');
  await runner.net.openRoom({ relayHost: 'relay.test', code: false });
  const runnerInvite = runner.net.info().link.split('#j=')[1];
  assert.equal(runner.net.peekInvite(runnerInvite).mode, 'runner');
  await assert.rejects(other.net.acceptJoin(runnerInvite, { mode: 'race' }), /different game mode/i);
  async function rawHello(target, caps, mode) {
    const api = target.net._n1, session = api.session();
    const key = await api.keys.genKeypair();
    const pair = api.env.makePair(await api.keys.derivePairKey(key, session.keys.pub, session.roomId, session.epoch), session.roomId, session.epoch, api.env.DIR_G2H);
    const proof = api.invite.joinProof(session.secret, session.roomId, session.epoch, key.pub, session.keys.pub);
    const pt = api.frames.encHello(api.frames.makeScratch(), { tag: 'OLD', proof16: proof, caps, mode }).slice();
    let reply;
    const send = session.relay.send; session.relay.send = (pub, wire) => { reply = wire; };
    try { await session._onPacket(key.pub, await api.env.sealApp(pair, pt)); }
    finally { session.relay.send = send; }
    assert.ok(reply, 'mode mismatch receives an explicit encrypted rejection');
    const plain = (await api.env.openApp(pair, reply)).pt;
    assert.deepEqual([...plain], [target.net._room.bye.A_BYE, 3, target.net._room.race.INV_RACE]);
  }
  await rawHello(host, host.net._room.CAPS, undefined); // original protocol-6 runner
  await rawHello(host, host.net._room.CAPS | host.net._room.caps.CAP_RACE, undefined);
  await rawHello(host, host.net._room.CAPS, 2);
  await rawHello(runner, host.net._room.CAPS | host.net._room.caps.CAP_RACE, 2);
  await arena.net.openRoom({ relayHost: 'relay.test', code: false, mode: 'arena' });
  await rawHello(host, host.net._room.CAPS | host.net._room.caps.CAP_ARENA, 1);
  await rawHello(host, host.net._room.CAPS | host.net._room.caps.CAP_ARENA, 2);
  await rawHello(arena, host.net._room.CAPS | host.net._room.caps.CAP_RACE, 2);
  assert.equal(arena.net._n1.session().roster.size, 0);
  assert.equal(hs.roster.size, 0); assert.equal(runner.net._n1.session().roster.size, 0);
});

test('a race guest rejects an old runner WELCOME even if it advertises a race capability', async (t) => {
  const { host, guests } = await room(t), [guest] = guests;
  const bye = collect(guest.net, 'bye'), F = host.net._n1.frames;
  const pt = F.encWelcome(F.makeScratch(), { yourP: 2, seed: 9, runId: 1, hostTag: 'BAD', caps: host.net.info().caps });
  await fromHost(host, guest, pt);
  assert.equal(bye.events.length, 1); assert.equal(bye.events[0].modeMismatch, true);
  assert.equal(await guest.net.sendRace(bytes(18)), false);
});

test('fragments reorder safely; stale, duplicate, incomplete and malformed messages stay bounded', async (t) => {
  const { host, guests, hs, hub } = await room(t), [guest] = guests;
  const gs = guest.net._n1.session(), F = host.net._room.race, rx = collect(host.net);
  const row = [...hs.roster.values()][0], full = bytes(1024), count = Math.ceil(full.length / F.RACE_CHUNK);
  const wires = [];
  for (let i = 0; i < count; i++) {
    const pt = F.raceFragment(full, 100, i); assert.ok(pt.length <= 229);
    const wire = await guest.net._n1.env.sealApp(gs.pair, pt); assert.ok(wire.length <= 256); wires.push(wire);
  }
  for (const i of [3, 0, 2, 1, 4]) await hs._onPacket(gs.keys.pub, wires[i]);
  assert.equal(rx.events.length, 1); assert.deepEqual(rx.events[0].bytes, full);
  await fromGuest(host, guest, F.raceFragment(full, 100, 0));
  await fromGuest(host, guest, F.raceFragment(full, 99, 0));
  assert.equal(rx.events.length, 1); assert.equal(row.arenaRx.data, null);
  await fromGuest(host, guest, F.raceFragment(full, 101, 0));
  assert.equal(row.arenaRx.data.length, 1024);
  hub.advance(F.RACE_TTL + 1); await hs._snapTick();
  assert.equal(row.arenaRx.data, null, 'expired buffers released by housekeeping');
  for (let i = 1; i < count; i++) await fromGuest(host, guest, F.raceFragment(full, 101, i));
  assert.equal(rx.events.length, 1, 'expired IDs cannot resume');
  await fromGuest(host, guest, F.raceFragment(bytes(18), 102, 0));
  assert.equal(rx.events.length, 2);
  const malformed = F.raceFragment(bytes(18), 103, 0); malformed[7] = 9;
  await fromGuest(host, guest, malformed); assert.equal(row.strikes, 1);
  const oversized = F.raceFragment(bytes(18), 104, 0); new DataView(oversized.buffer).setUint16(5, 1025, true);
  await fromGuest(host, guest, oversized); assert.equal(row.strikes, 2);
  assert.equal(rx.events.length, 2); assert.equal(row.arenaRx.data, null);
});

test('race app packet size, crypto queue and receive-rate limits are enforced', async (t) => {
  const { host, guests, hs, hub } = await room(t), [guest] = guests;
  for (const bad of [new Uint8Array(), bytes(1025), 'bad', null, [1, 2, 3]]) assert.equal(await guest.net.sendRace(bad), false);
  assert.equal(await host.net.sendRace(bytes(18), 99), false);
  const api = guest.net._n1, key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const pair = api.env.makePair(key, new Uint8Array(8), 0, api.env.DIR_G2H);
  const promises = Array.from({ length: 200 }, () => api.env.sealApp(pair, new Uint8Array([64])));
  const outcomes = await Promise.allSettled(promises);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, host.net._room.race.SEAL_QUEUE_MAX);
  assert.equal(pair.sealPending, 0);
  await assert.rejects(api.env.sealApp(pair, bytes(230)), /too large/);
  const rx = collect(host.net), F = host.net._room.race, row = [...hs.roster.values()][0];
  const now = hub.now(); host.context.performance.now = () => now;
  row.arenaRate = { t: now, frames: 2, bytes: 65536 };
  for (let i = 1; i <= 8; i++) await fromGuest(host, guest, F.raceFragment(bytes(18), i, 0));
  assert.equal(rx.events.length, 2); assert.equal(row.strikes, 0, 'over-rate is dropped without banning honest bursts');
  host.context.performance.now = () => now + 1000;
  await fromGuest(host, guest, F.raceFragment(bytes(18), 9, 0)); assert.equal(rx.events.length, 3);
});

test('backpressure replaces pending snapshots with the latest and never grows crypto queues', async (t) => {
  const { host, guests, hs } = await room(t), [guest] = guests, rx = collect(guest.net);
  const oldBacklog = hs.relay.backlog; hs.relay.backlog = () => 5000;
  const sends = Array.from({ length: 100 }, (_, i) => host.net.sendRace(bytes(700, i)));
  const row = [...hs.roster.values()][0];
  assert.equal(row.arenaTx.pending.bytes[0], 99); assert.ok((row.pair.sealPending || 0) <= 1);
  hs.relay.backlog = oldBacklog;
  const outcomes = await Promise.all(sends);
  assert.equal(outcomes.filter(Boolean).length, 1);
  await until(() => rx.events.length === 1, 'latest coalesced snapshot');
  assert.deepEqual(rx.events[0].bytes, bytes(700, 99)); assert.equal(row.arenaTx.pending, null);
  // Also bound in-flight crypto, independently of the socket signal.
  const rapid = Array.from({ length: 100 }, (_, i) => host.net.sendRace(bytes(700, i)));
  const sent = await Promise.all(rapid); assert.ok(sent.filter(Boolean).length <= 2);
  assert.ok((row.pair.sealPending || 0) <= 1);
});

test('role locks reject elevation and host switches, admit late viewers, and keep reconnect seats', async (t) => {
  const { host, guests, hs, join } = await room(t, { spectators: 1 }), [player, spectator] = guests;
  const before = player.net.info().myP, gs = player.net._n1.session();
  assert.equal(host.net.setRaceRoleLock(true), true);
  assert.equal(await spectator.net.setRole(0), false);
  assert.equal(await player.net.setRole(1), false);
  assert.equal(await host.net.setRole(1), false);
  assert.equal(spectator.net.setRaceRoleLock(false), false);
  const late = await join(0); assert.equal(late.net.info().role, 1, 'late join becomes a spectator');
  const gen = gs.welcomeGen;
  gs.relay.kick('race reconnect test');
  await until(() => [...hs.roster.values()].some((r) => r.p === before && r.absent), 'seat reserved while absent');
  await until(() => gs.welcomeGen > gen, 'same-seat race reconnect', 8000);
  assert.equal(player.net.info().myP, before); assert.equal(player.net.info().role, 0);
  const row = [...hs.roster.values()].find((r) => r.p === before);
  assert.equal(row.absent, false); assert.equal(row.strikes, 0);
  host.net.setRaceRoleLock(false); assert.equal(await spectator.net.setRole(0), true);
});

test('race does not emit or accept runner presence, kills, or shared rounds', async (t) => {
  const { host, guests, hs } = await room(t), [guest] = guests;
  const hostKills = collect(host.net, 'kill'), guestKills = collect(guest.net, 'kill'), snaps = collect(guest.net, 'snap'), rounds = collect(guest.net, 'round');
  const gs = guest.net._n1.session(), F = guest.net._n1.frames, scratch = F.makeScratch();
  host.net.sendPresence(1, 2, 3, 11, 0, 1, 1); guest.net.sendPresence(1, 2, 3, 11, 0, 1, 1);
  host.net.kill(800); guest.net.kill(800);
  assert.equal(host.net.startRound(), undefined); assert.equal(host.net.newWorld(), undefined); assert.equal(host.net.markRoundStart(), undefined);
  await hs._snapTick(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(snaps.events.length, 0); assert.equal(rounds.events.length, 0);
  assert.equal(hostKills.events.length, 0); assert.equal(guestKills.events.length, 0);
  await fromGuest(host, guest, F.encPres(scratch, { t: 1, x: 1, y: 1, vx: 0, vy: 0, state: 11, chain: 0, score: 0, dist: 0, runId: 1 }).slice());
  const row = [...hs.roster.values()][0]; assert.equal(row.strikes, 1); assert.equal(row.pres, null);
  await fromHost(host, guest, F.encSnap(scratch, 1, [{ p: 1, pres: { t: 1, x: 1, y: 1, vx: 0, vy: 0, state: 11, runId: 1 } }]).slice());
  assert.equal(snaps.events.length, 0); assert.equal(gs.peers.size, 0);
});

test('race hard caps bound player and spectator seats; runner rooms cannot use the race lane', async (t) => {
  const { host, guests, hub, invite } = await room(t, { players: 3, spectators: 4 });
  assert.equal(host.net.info().players, 4); assert.equal(host.net.info().spectators, 4);
  const extra = client(hub, { game: false }), runner = client(hub, { game: false });
  t.after(() => { extra.close(); runner.close(); });
  await assert.rejects(extra.net.acceptJoin(invite, { mode: 'race' }), /full/);
  await assert.rejects(extra.net.acceptJoin(invite, { mode: 'race', role: 1 }), /full/);
  assert.equal(host.net.info().players, 4); assert.equal(host.net.info().spectators, 4);
  await runner.net.openRoom({ relayHost: 'relay.test', code: false });
  assert.equal(await runner.net.sendRace(bytes(18)), false); assert.equal(runner.net.setRaceRoleLock(true), false);
  assert.equal(runner.net.info().cap, 32); assert.equal(runner.net.info().specCap, 16);
});

test('immediately awaited sends cannot strand a new pending input between pump completions', async (t) => {
  const { host, guests } = await room(t), [guest] = guests, rx = collect(host.net);
  for (let i = 0; i < 15; i++) assert.equal(await guest.net.sendRace(bytes(18, i)), true);
  await until(() => rx.events.length === 15, 'every sequential input completed');
  assert.equal(rx.events[14].bytes[0], 14);
});

test('absent race seats remain reserved so a reconnect cannot overbook either role', async (t) => {
  const { host, guests, hs, hub, invite } = await room(t, { players: 1, spectators: 1, playerCap: 2, spectatorCap: 1 });
  assert.equal(guests[0].net.info().cap, 2); assert.equal(guests[0].net.info().specCap, 1);
  for (const guest of guests) hs._onPeerGone(guest.net._n1.session().keys.pub);
  assert.equal(host.net.info().players, 1); assert.equal(host.net.info().spectators, 0);
  const extra = client(hub, { game: false }); t.after(() => extra.close());
  await assert.rejects(extra.net.acceptJoin(invite, { mode: 'race' }), /full/);
  await assert.rejects(extra.net.acceptJoin(invite, { mode: 'race', role: 1 }), /full/);
  assert.equal(hs.roster.size, 2, 'reserved identities not replaced');
});

test('expired race seats free after 15s, late reconnects are viewers, and reused keys never repeat host nonces', async (t) => {
  const { host, guests, hs, hub } = await room(t), [guest] = guests;
  const gs = guest.net._n1.session(), api = guest.net._n1, F = api.frames, rx = collect(guest.net);
  for (let i = 0; i < 3; i++) await host.net.sendRace(bytes(18, i));
  await until(() => rx.events.length === 3, 'pre-disconnect snapshots');
  const oldRow = [...hs.roster.values()][0], lastHostCounter = oldRow.pair.sendCtr;
  hs._onPeerGone(gs.keys.pub); hub.advance(15001); await hs._snapTick();
  assert.equal(hs.roster.size, 0, 'race seat reservation expires, not the runner five-minute grace');
  host.net.setRaceRoleLock(true);
  const hello = F.encHello(F.makeScratch(), { tag: 'AAA', caps: host.net.info().caps, mode: 2, role: 0,
    proof16: api.invite.joinProof(gs.inv.secret, gs.inv.roomId, gs.inv.epoch, gs.keys.pub, gs.inv.hostPub) }).slice();
  const generation = gs.welcomeGen;
  await fromGuest(host, guest, hello);
  await until(() => gs.welcomeGen > generation && guest.net.info().role === 1, 'late reconnect readmitted as viewer');
  const newRow = [...hs.roster.values()][0]; assert.ok(newRow.pair.sendCtr > lastHostCounter);
  assert.equal(newRow.role, 1);
  await host.net.sendRace(bytes(18, 99));
  await until(() => rx.events.length === 4, 'new message-id range accepted after re-admission');
  assert.equal(rx.events[3].bytes[0], 99);
});

test('the relay receive queue is bounded even if decryption stalls', async (t) => {
  const { host, guests, hs } = await room(t), [guest] = guests, gs = guest.net._n1.session();
  const wire = await guest.net._n1.env.sealApp(gs.pair, host.net._room.race.raceFragment(bytes(18), 1, 0));
  const payload = host.net._n1.bytes.cat(gs.keys.pub, wire), frame = new Uint8Array(5 + payload.length);
  frame[0] = 5; new DataView(frame.buffer).setUint32(1, payload.length, false); frame.set(payload, 5);
  await hs.relay.hq;
  let release; hs.relay.hq = new Promise((r) => { release = r; });
  const socket = hs.relay.ws, queue = hs.relay.hqState;
  for (let i = 0; i < 300; i++) socket.onmessage({ data: frame.buffer });
  assert.ok(queue.n <= 256); assert.ok(queue.bytes <= 262144);
  assert.equal(hs.relay.state, 'down', 'overflow closes this transport instead of retaining arbitrary ciphertext');
  release(); await hs.relay.hq; assert.equal(queue.n, 0); assert.equal(queue.bytes, 0);
});

test('leaving a room settles a backpressured latest send instead of retaining it', async (t) => {
  const { host, guests, hs } = await room(t), [guest] = guests;
  hs.relay.backlog = () => 5000;
  const pending = host.net.sendRace(bytes(700));
  host.net.leave(); assert.equal(await pending, false);
  await until(() => guest.net._n1.session().byed !== null, 'host closed');
});

test('race and arena invitations cannot cross modes, even with both invite markers set', async (t) => {
  const { hub, host, invite } = await room(t, { players: 0 });
  const arena = client(hub, { game: false }), joiner = client(hub, { game: false });
  t.after(() => { arena.close(); joiner.close(); });
  await arena.net.openRoom({ mode: 'arena', relayHost: 'relay.test', code: false });
  const arenaInvite = arena.net.info().link.split('#j=')[1];
  await assert.rejects(joiner.net.acceptJoin(invite, { mode: 'arena' }), /different game mode/);
  await assert.rejects(joiner.net.acceptJoin(arenaInvite, { mode: 'race' }), /different game mode/);
  assert.equal(joiner.net._n1.session(), null, 'invite mismatches allocate no session');
  const api = host.net._n1, mixed = api.invite.decodeInvite(invite).inv;
  mixed.flags |= host.net._room.arena.INV_ARENA;
  const mixedInvite = api.invite.encodeInvite(mixed);
  assert.equal(host.net.peekInvite(mixedInvite).mode, 'invalid');
  for (const mode of ['runner', 'arena', 'race']) {
    await assert.rejects(joiner.net.acceptJoin(mixedInvite, { mode }), /different game mode/);
    assert.equal(joiner.net._n1.session(), null);
  }
  const original = host.net._n1.session();
  await assert.rejects(host.net.openRoom({ mode: 'arena' }), /different game mode/);
  await assert.rejects(host.net.acceptJoin(arenaInvite, { mode: 'arena' }), /different game mode/);
  assert.equal(host.net._n1.session(), original, 'wrong-mode actions do not replace the active room');
  assert.equal(await host.net.sendArena(bytes(18)), false);
  assert.equal(host.net.setArenaRoleLock(true), false);
  assert.equal(await arena.net.sendRace(bytes(18)), false);
  assert.equal(arena.net.setRaceRoleLock(true), false);
});

test('authenticated arcade opcodes are isolated before assembly and dispatch', async (t) => {
  for (const mode of ['race', 'arena']) {
    const { host, guests, hs } = await room(t, { mode }), [guest] = guests;
    const other = mode === 'race' ? 'arena' : 'race';
    const hostRx = collect(host.net, mode + '-data'), guestRx = collect(guest.net, mode + '-data');
    const hostWrong = collect(host.net, other + '-data'), guestWrong = collect(guest.net, other + '-data');
    const foreign = host.net._room[other][other + 'Fragment'](bytes(300), 1000, 0);
    await fromGuest(host, guest, foreign); await fromHost(host, guest, foreign);
    assert.equal(hostRx.events.length + guestRx.events.length + hostWrong.events.length + guestWrong.events.length, 0);
    assert.equal([...hs.roster.values()][0].strikes, 0, 'reserved foreign opcode is ignored');
    assert.equal(await guest.net[mode === 'race' ? 'sendRace' : 'sendArena'](bytes(18, 41)), true);
    assert.equal(await host.net[mode === 'race' ? 'sendRace' : 'sendArena'](bytes(300, 42)), true);
    await until(() => hostRx.events.length === 1 && guestRx.events.length === 1, 'same-mode payloads survive foreign message ids');
    assert.equal(hostRx.events[0].bytes[0], 41); assert.equal(guestRx.events[0].bytes[0], 42);
  }
});

test('race WELCOME requires its own marker and capability; arena capability alone is insufficient', async (t) => {
  for (const [mode, withRaceCap] of [[1, true], [2, false]]) {
    const { host, guests } = await room(t), [guest] = guests;
    const F = host.net._n1.frames, cap = host.net._room.caps;
    const caps = host.net._room.CAPS | cap.CAP_ARENA | (withRaceCap ? cap.CAP_RACE : 0);
    const bye = collect(guest.net, 'bye');
    const pt = F.encWelcome(F.makeScratch(), { yourP: 2, seed: 1, runId: 1, hostTag: 'BAD', mode, caps });
    await fromHost(host, guest, pt);
    assert.equal(bye.events.length, 1); assert.equal(bye.events[0].modeMismatch, true);
    assert.equal(bye.events[0].detail, host.net._room.race.INV_RACE);
    assert.equal(await guest.net.sendRace(bytes(18)), false);
  }
});

test('race invite rotation preserves mode and a host relay reconnect preserves encrypted gameplay', async (t) => {
  const { host, guests, hs, invite, hub } = await room(t), [guest] = guests;
  const before = guest.net.info().myP, rx = collect(guest.net);
  const rotated = await host.net.rotateLink();
  const newInvite = rotated.link.split('#j=')[1];
  assert.notEqual(newInvite, invite); assert.equal(host.net.peekInvite(newInvite).mode, 'race');
  let restored = false; host.net.onEvent('reconnected', () => { restored = true; });
  hs.relay.kick('race host reconnect test');
  await until(() => restored, 'race host reconnect', 8000);
  await until(() => !guest.net._n1.session().hostGoneTimer, 'guest recognizes host return', 8000);
  assert.equal(guest.net.info().myP, before); assert.equal(host.net.info().players, 2);
  assert.equal(await host.net.sendRace(bytes(700, 59)), true);
  await until(() => rx.events.length === 1, 'race snapshot after host reconnect');
  assert.equal(rx.events[0].bytes[0], 59);
  const newcomer = client(hub, { game: false }); t.after(() => newcomer.close());
  await newcomer.net.acceptJoin(newInvite, { mode: 'race' });
  assert.equal(newcomer.net.info().mode, 'race');
});

test('race page reload restoration is refused before reusing any persisted keys', async (t) => {
  const { hub, host, invite } = await room(t, { players: 0 });
  const c = client(hub, { game: false }); t.after(() => c.close());
  await assert.rejects(c.net.acceptJoin(invite, { mode: 'race', resumeKey: '00'.repeat(32) }), /fresh identity/);
  assert.equal(c.net._n1.session(), null);
  await assert.rejects(c.net.openRoom({ mode: 'race', relayHost: 'relay.test', code: false, resume: {} }), /cannot be restored/);
  assert.equal(c.net._n1.session(), null);
  assert.equal(host.net.resumeToken(), null);
});

test('race short codes resolve to the same explicit invite on the existing encrypted rendezvous', async (t) => {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false }), arena = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); arena.close(); });
  const live = new Promise(resolve => host.net.onEvent('code-live', resolve));
  await host.net.openRoom({ mode: 'race', region: 'nyc' }); await live;
  const { invite } = await guest.net.lookupCode(host.net.info().joinCode);
  assert.equal(guest.net.peekInvite(invite).mode, 'race');
  assert.equal(guest.net.parseJoin(host.net.info().link).payload, invite);
  await assert.rejects(arena.net.enterCode(host.net.info().joinCode, { mode: 'arena' }), /different game mode/);
  assert.equal(arena.net._n1.session(), null);
  await guest.net.enterCode(host.net.info().joinCode, { mode: 'race' });
  await until(() => guest.net.roster().some(r => r.you), 'race code admitted');
  assert.equal(host.net.info().players, 2);
  const rx = collect(host.net);
  assert.equal(await guest.net.sendRace(bytes(18, 91)), true);
  await until(() => rx.events.length === 1, 'encrypted race command after code join');
  assert.equal(rx.events[0].bytes[0], 91);
});
