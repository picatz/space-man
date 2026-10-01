const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A page killed by a reload or crash says nothing: its sockets just stop. (client.close() is a polite BYE; this is not.)
function crash(c) { const s = c.net._n1.session(); if (s.snapTimer) s.snapTimer.stop(); s.relay.close(); }

test('a host rebuilt from its token keeps the same invite, and members who were waiting find it', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  const reborn = client(hub);
  t.after(() => { host.close(); guest.close(); reborn.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const link = host.net.info().link, payload = link.split('#j=')[1];
  await guest.net.acceptJoin(payload, { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');

  const token = JSON.parse(JSON.stringify(host.net.resumeToken()));   // what survives a reload: plain JSON
  assert.equal(token.host, true);
  assert.match(token.priv, /^[0-9a-f]{64}$/);
  crash(host);                                                        // the tab is gone

  await reborn.net.openRoom({ relayHost: 'relay.test', code: false, resume: token, adjIdx: 0, nounIdx: 0 });
  assert.equal(reborn.net.info().link, link, 'the invite everyone already holds still works');
  assert.equal(reborn.net.info().seed, token.seed, 'same course');
  // A brand-new guest can join the restored room with the old link.
  const late = client(hub); t.after(() => late.close());
  hub.advance(6000);
  await late.net.acceptJoin(payload, { adjIdx: 2, nounIdx: 2 });
  assert.ok(late.net.info().myP >= 2);
  assert.equal(late.net.info().seed, token.seed);
});

test('a guest who comes back with its saved key is seated in the same place', async (t) => {
  const hub = relay(), host = client(hub), a = client(hub), b = client(hub), a2 = client(hub);
  t.after(() => { host.close(); a.close(); b.close(); a2.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const payload = host.net.info().link.split('#j=')[1];
  await a.net.acceptJoin(payload, { adjIdx: 1, nounIdx: 1 });
  await b.net.acceptJoin(payload, { adjIdx: 2, nounIdx: 2 });
  const pa = a.net.info().myP, pb = b.net.info().myP;
  assert.deepEqual([pa, pb], [2, 3]);
  const token = JSON.parse(JSON.stringify(a.net.resumeToken()));
  assert.equal(token.host, false); assert.equal(token.invite, payload);
  a.close();                                                          // refresh: the old socket drops with the tab
  await until(() => [...host.net._n1.session().roster.values()].some((r) => r.absent), 'seat held');
  await a2.net.acceptJoin(token.invite, { adjIdx: 1, nounIdx: 1, resumeKey: token.priv });
  assert.equal(a2.net.info().myP, pa, 'same P#, not the next free one');
  assert.equal(host.net.info().players, 3);
  await sleep(10);
});

test('tokens are absent for a mock room and malformed resume data is ignored, not trusted', async (t) => {
  const hub = relay(), host = client(hub);
  t.after(() => host.close());
  assert.equal(host.net.resumeToken(), null, 'no room, no token');
  await host.net.openRoom({ relayHost: 'relay.test', code: false, resume: { priv: 'zz', roomId: '1', secret: '2', epoch: 1 } });
  const t1 = host.net.resumeToken();
  assert.match(t1.roomId, /^[0-9a-f]{16}$/, 'a fresh room, not the garbage one');
});

test('members who stay connected while the host reloads are carried into the restored room, no clicks needed', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub), reborn = client(hub);
  t.after(() => { host.close(); guest.close(); reborn.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  const events = [];
  guest.net.onEvent((e) => events.push(e));
  // Plenty of traffic first, so the old page's counters are well past any replay window.
  for (let i = 0; i < 60; i++) host.net._n1.session().setPresence(i, 0, 0, 9, 0, i, i, i, 0);
  hub.advance(3000); await sleep(20);
  const token = JSON.parse(JSON.stringify(host.net.resumeToken()));
  crash(host);
  await reborn.net.openRoom({ relayHost: 'relay.test', code: false, resume: token, adjIdx: 0, nounIdx: 0 });
  // The guest knocks every 5.5 s of real time while the host is away (the harness's timers are real; only its clock is steered).
  for (let i = 0; i < 400 && reborn.net.info().players < 2; i++) { hub.advance(300); await sleep(25); }
  assert.equal(reborn.net.info().players, 2, 'the guest found the restored host and was seated');
  await until(() => guest.net.info().hostAway === false, 'guest sees the host is back');
  assert.ok(events.includes('hostaway') && events.includes('hostback'), 'it was told the host went quiet, then came back');
  assert.ok(!events.includes('bye'), 'nobody was told the room closed');
});
