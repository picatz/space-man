const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function room(t, { approve = false } = {}) {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0, approve });
  const link = host.net.info().link.split('#j=')[1];
  if (!approve) {
    await guest.net.acceptJoin(link, { adjIdx: 1, nounIdx: 1 });
    await until(() => guest.net.roster().length === 2, 'complete roster');
  }
  return { hub, host, guest, link };
}
// Drop the guest's relay socket the way a network blip does; it reconnects.
function drop(c) { const ws = c.net._n1.session().relay.ws; ws.close(); ws.onclose(); }
const hostRows = (host) => [...host.net._n1.session().roster.values()];

test('members reconnect after the host rotates the invite link', async (t) => {
  const { hub, host, guest } = await room(t);
  const strikes = [];
  host.net.onEvent((e, d) => { if (e === 'strike') strikes.push(d.why); });
  host.net.rotateLink();
  for (let i = 0; i < 3; i++) {
    drop(guest);
    await until(() => hostRows(host)[0]?.absent === false && guest.net._n1.session().relay.state === 'established', 'rejoin ' + i);
    hub.advance(6000);
    await sleep(50);
  }
  assert.deepEqual(strikes, []);
  assert.equal(hostRows(host).length, 1);
  assert.equal(hostRows(host)[0].absent, false);
});

test('a second quick reconnect keeps re-helloing until the host welcomes it', async (t) => {
  const { hub, host, guest } = await room(t);
  drop(guest);
  await until(() => hostRows(host)[0].absent === false, 'first rejoin');
  hostRows(host)[0].lastHello = hub.now(); // the host's 5 s hello limiter will drop the next re-hello
  drop(guest);
  await until(() => hostRows(host)[0].absent === true, 'second drop seen');
  await until(() => hostRows(host)[0].absent === false && host.net.roster().length === 2, 'second rejoin', 12000);
});

test('guests are told when the host closes the room', async (t) => {
  const { host, guest } = await room(t);
  let bye = null;
  guest.net.onEvent((e, d) => { if (e === 'bye') bye = d; });
  host.run('leaveRoom()');
  await until(() => bye, 'bye to guest');
  assert.equal(bye.reason, 1);
  assert.equal(guest.net.active, false, 'the game leaves the dead room');
});

test('a host that vanishes without a goodbye still ends the room after a grace period', async (t) => {
  const { host, guest } = await room(t);
  const gs = guest.net._n1.session();
  let bye = null;
  guest.net.onEvent((e, d) => { if (e === 'bye') bye = d; });
  host.net._n1.session().relay.close(); // transport gone, no BYE
  await until(() => gs.hostGoneTimer, 'host-gone timer armed');
  assert.equal(bye, null, 'a transport blip is not an ending');
  clearTimeout(gs.hostGoneTimer); gs.hostGoneTimer = null;
  gs.ev.emit('bye', { reason: 1, detail: 0 }); // the timer's effect, without waiting 15 s
  assert.equal(bye.reason, 1);
});

test('absent rows free their P# after the reconnect grace period', async (t) => {
  const { hub, host, link } = await room(t);
  for (let i = 0; i < 3; i++) {
    const g = client(hub, { game: false });
    await g.net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 });
    g.close();
    await until(() => hostRows(host).some((r) => r.absent), 'absent row');
    hub.advance(301000);
    await until(() => !hostRows(host).some((r) => r.absent), 'absent row expires');
  }
  const g = client(hub, { game: false });
  t.after(() => g.close());
  await g.net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 });
  assert.equal(g.net.info().myP, 3);
  assert.equal(hostRows(host).length, 2);
});

test('a held join whose guest gave up is never admitted as a phantom', async (t) => {
  const { hub, host, guest, link } = await room(t, { approve: true });
  guest.net.acceptJoin(link, {}).catch(() => {});
  await until(() => host.net._n1.session().pending.size === 1, 'approval request');
  const key = [...host.net._n1.session().pending.keys()][0];
  guest.net.leave(); // gives up; its admission promise just times out later
  await until(() => host.net._n1.session().pending.size === 0, 'pending dropped on peer gone');
  assert.equal(await host.net.approve(key, true), false);
  hub.advance(60000); await sleep(150);
  assert.equal(JSON.stringify(host.net.roster().map((r) => r.p)), '[1]');
  assert.equal(host.net.info().players, 1);
});

test('a strike ban is announced to the room and frees the board row', async (t) => {
  const { hub, host, guest, link } = await room(t);
  const other = client(hub);
  t.after(() => other.close());
  await other.net.acceptJoin(link, { adjIdx: 3, nounIdx: 3 });
  await until(() => other.net.roster().length === 3, 'three members');
  const hs = host.net._n1.session();
  const row = hostRows(host).find((r) => r.p === 2);
  hs._board.set(2, { p: 2, callsign: 'X', bestScore: 999, bestDist: 99, bestChain: 0, unverified: false });
  // Three oversized packets are three strikes → ban.
  for (let i = 0; i < 3; i++) await hs._onPacket(row.pub, new Uint8Array(400));
  assert.equal(hs.banned.size, 1);
  assert.equal(hs._board.has(2), false);
  await until(() => other.net.roster().length === 2, 'others drop the banned member');
});

test('leaving a room clears held join requests from the host card', async (t) => {
  const { host, guest, link } = await room(t, { approve: true });
  guest.net.acceptJoin(link, {}).catch(() => {});
  await until(() => host.run('pendingJoins.size') === 1, 'held join shown');
  host.run('leaveRoom()');
  assert.equal(host.run('pendingJoins.size'), 0);
  guest.net.leave();
});

test('a reused P# does not inherit the previous player board', async (t) => {
  const { hub, host, guest, link } = await room(t);
  const gs = guest.net._n1.session();
  const first = client(hub, { game: false });
  await first.net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 });
  await until(() => guest.net.roster().length === 3, 'P3 listed');
  gs._board.set(3, { p: 3, callsign: 'OLD', bestScore: 5000, bestDist: 500, bestChain: 0, unverified: false });
  await host.net.kick(3);
  first.close();
  await until(() => guest.net.roster().length === 2, 'kick seen');
  assert.equal(gs._board.has(3), false);
  const next = client(hub, { game: false });
  t.after(() => next.close());
  await next.net.acceptJoin(link, { adjIdx: 4, nounIdx: 4 });
  assert.equal(next.net.info().myP, 3);
  assert.equal(host.net._n1.session()._board.has(3), false);
});

test('a full P# range reclaims the longest-absent slot instead of admitting an invisible P33', async (t) => {
  const { hub, host, link } = await room(t);
  const hs = host.net._n1.session();
  // Occupy P3..P32 with members who dropped moments ago (still inside the grace).
  const hex = host.net._n1.bytes.hex, keyOf = (p) => hex(new Uint8Array(32).fill(p));
  for (let p = 3; p <= 32; p++) {
    hs.roster.set(keyOf(p), { p, pub: new Uint8Array(32).fill(p), tag: 'AAA', role: 0, absent: true, absentAt: hub.now() - (40 - p), strikes: 0 });
  }
  const g = client(hub, { game: false });
  t.after(() => g.close());
  await g.net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 });
  assert.equal(g.net.info().myP, 3, 'the longest-absent slot (P3) is reused');
  assert.equal(hs.roster.has(keyOf(3)), false);
  assert.equal(hs.roster.has(keyOf(4)), true, 'only one slot is reclaimed');
  await until(() => g.net.roster().some((e) => e.you), 'the newcomer sees itself');
});

test('a guest refused because the runner room is full gets BYE(4) at once, not a 30 s join timeout', async (t) => {
  const hub = relay(), host = client(hub), g = client(hub, { game: false });
  t.after(() => { host.close(); g.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const link = host.net.info().link.split('#j=')[1], hs = host.net._n1.session();
  hs.playerCap = 1;                                         // the host alone fills the room
  const before = hs.roster.size, started = Date.now(), events = [];
  g.net.onEvent((e, d) => { if (e === 'bye') events.push(d); });
  await assert.rejects(g.net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 }), /room is full/i);
  assert.ok(Date.now() - started < 5000, 'refusal arrives immediately, not after the 30 s admission clock');
  assert.equal(events[0]?.reason, 4);
  assert.equal(hs.roster.size, before, 'the refused guest never took a seat');
});

test('the hello loop keeps retrying past five attempts until a WELCOME arrives', async (t) => {
  const { host, guest } = await room(t);
  const gs = guest.net._n1.session();
  let hellos = 0;
  const send = gs.relay.send.bind(gs.relay);
  hostRows(host)[0].lastHello = Infinity; // the host drops every re-hello for now
  drop(guest);
  await until(() => gs.relay.state === 'established' && gs.helloTimer, 'reconnected and re-helloing');
  gs.relay.send = (pub, w) => { hellos++; send(pub, w); };
  // Fire the interval body directly instead of waiting 5.5 s per attempt.
  for (let i = 0; i < 7; i++) { assert.ok(gs.helloTimer, 'still retrying after ' + (i + 1) + ' attempts'); gs.helloTimer._onTimeout?.(); }
  await until(() => hellos >= 7, 'seven more HELLOs actually sent');
  hostRows(host)[0].lastHello = 0;
  gs.helloTimer._onTimeout?.();
  await until(() => hostRows(host)[0].absent === false, 'finally welcomed');
  await until(() => !gs.helloTimer || gs.welcomeGen > 0, 'loop ends on WELCOME');
});

test('a mid-round seat never lands a late joiner on an enemy', async (t) => {
  const { host } = await room(t);
  host.run('startRun({sync:true})');
  const hits = JSON.parse(host.run(`JSON.stringify((() => {
    const bad = [];
    for (let ms = 4000; ms <= 90000; ms += 1500) {
      resetRun(NET.info().seed); seatMidRound(ms);
      const pl = G.player.groundPlat;
      // Never on a walker's slab, never within 220px of a shooter or sentinel. Divers (which never
      // reach a grounded player) and high bombers don't make a slab unsafe.
      const x = G.player.x;
      if (G.enemies.some((e) => !e.dead && e.type !== 'diver' && e.type !== 'bomber' && e.x + e.w >= pl.x - 40 && e.x <= pl.x + pl.w + 40
        && (e.type === 'shoot' || e.type === 'turret' ? Math.abs(e.x - x) < 220 : true))) bad.push(ms);
    }
    return bad;
  })())`));
  assert.equal(hits.length, 0, 'enemies on the seat platform at ' + hits.join(', ') + ' ms');
});

test('a full roster snapshot drops members the guest missed leaving', async (t) => {
  const { host, guest } = await room(t);
  const gs = guest.net._n1.session();
  gs.rosterMap.set(9, { tag: 'AAA', role: 0, callsign: 'GONE', you: false }); // left while our link was down
  gs.peers.set(9, { p: 9, x: 100, y: 100 });
  host.net._n1.session().setCallsign(3, 3); // any full roster
  await until(() => !gs.rosterMap.has(9), 'stale member dropped');
  assert.equal(gs.peers.has(9), false);
  assert.equal(guest.net.roster().length, 2);
});

test('a rejoin gets the full snapshot; others only see an upsert', async (t) => {
  const { hub, host, guest, link } = await room(t);
  const other = client(hub, { game: false });
  t.after(() => other.close());
  await other.net.acceptJoin(link, { adjIdx: 4, nounIdx: 4 });
  await until(() => guest.net.roster().length === 3, 'three members');
  const ops = [];
  other.net._n1.session().ev.on((e, d) => { if (e === 'roster') ops.push(d.op); });
  drop(guest);
  await until(() => hostRows(host).find((r) => r.p === 2)?.absent === false, 'guest back');
  await until(() => ops.includes(1), 'others told of the return');
  assert.equal(ops.includes(0), false, 'the rest of the room is not re-sent a snapshot');
});

// ---- MP-01 / SEC-01 / MP-02 / MP-03 / SEC-03 regressions ----
const nb = require('./netbench.cjs');
async function absentRejoin(t, { heavy = 0 } = {}) {
  const hub = nb.shape(relay()), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'roster');
  const hs = host.net._n1.session(), gs = guest.net._n1.session(), row = [...hs.roster.values()][0];
  let f = 0; const feed = setInterval(() => { f++; host.net.sendPresence(30 + f * 5, 250, 50, 9, 0, f, f, f, 0); }, 100);
  await until(() => gs.pair.highSeen > 60, 'window past REPLAY_WIN', 20000); clearInterval(feed);
  row.pair.sendCtr += heavy;
  let welcomes = 0; guest.net.onEvent('welcomed', () => welcomes++);
  guest.link.down = true; hs._onPeerGone(row.pub); hub.advance(301000); await hs._snapTick();
  assert.equal(hs.roster.size, 0, 'row purged after grace');
  guest.link.down = false; guest.link.deadBefore = Date.now();
  await until(() => welcomes > 0, 're-welcomed after a long absence', 40000);
  return { hs, row, nrow: [...hs.roster.values()][0] };
}
test('a guest absent longer than ABSENT_GRACE is re-welcomed on the same pair (counters never restart)', async (t) => {
  const { row, nrow } = await absentRejoin(t);
  assert.ok(nrow.pair.sendCtr > row.pair.sendCtr, 'new pair never reuses old counters');
});
test('purge + rejoin never reuses a host->guest counter under the same pair key', async (t) => {
  const { hs, row, nrow } = await absentRejoin(t, { heavy: 1e13 });   // old pair ran far ahead of the wall clock
  assert.ok(nrow.pair.sendCtr > row.pair.sendCtr, 'floor keeps counters monotonic per key');
  assert.ok(hs.ctrFloor.get(hex0(row.pub)) >= 1e13);
});
const hex0 = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

test('approve-mode: held guests\' HELLO retries do not burn the join budget', async (t) => {
  const hub = relay(), host = client(hub), gs = [client(hub), client(hub), client(hub)];
  t.after(() => { host.close(); gs.forEach((g) => g.close()); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, approve: true });
  const link = host.net.info().link.split('#j=')[1];
  const hs = host.net._n1.session();
  const waits = [];
  host.net.onEvent((e, d) => { if (e === 'approve-wait') waits.push(d.pubHex); });
  gs[0].net.acceptJoin(link, { adjIdx: 0, nounIdx: 0 }).catch(() => {});
  gs[1].net.acceptJoin(link, { adjIdx: 1, nounIdx: 1 }).catch(() => {});
  await until(() => waits.length === 2, 'two held');
  for (let i = 0; i < 6; i++) { hub.advance(5600); await sleep(30); }   // ~34 s of HELLO retries
  gs[2].net.acceptJoin(link, { adjIdx: 2, nounIdx: 2 }).catch(() => {});
  await until(() => waits.length === 3, 'third guest is seen too');
  assert.equal(hs.joinTimes.length, 0, 'held joins are not admissions');
  assert.equal(new Set(waits).size, 3);
});

test('a known row\'s quick re-HELLO is limited to ~1 s, not 5 s', async (t) => {
  const { hub, host, guest } = await room(t);
  drop(guest);
  await until(() => hostRows(host)[0].absent === false && guest.net._n1.session().relay.state === 'established', 'first rejoin');
  const row = hostRows(host)[0];
  hub.advance(1500);                                          // >1 s since the last HELLO, <5 s
  const before = row.lastHello;
  drop(guest);
  await until(() => row.lastHello > before, 'second re-HELLO accepted after ~1.5 s');
});

test('pre-join token bucket: a key spray derives at most the burst', async (t) => {
  const { host } = await room(t);
  const hs = host.net._n1.session(), n0 = hs.preDerives || 0;
  const junk = new Uint8Array(70).fill(7);
  for (let i = 0; i < 200; i++) {
    const pub = new Uint8Array(32); pub[0] = i + 1; pub[1] = 0xee; pub[31] = 9;
    hs._onPacket(pub, junk);
  }
  await sleep(300);
  const d = (hs.preDerives || 0) - n0;
  assert.ok(d >= 1 && d <= 22, 'derivations bounded by burst (got ' + d + ')');
});
