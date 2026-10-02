// Authoritative arcade seats retain curated callsign indices independently of
// the live roster. Names remain the existing two-byte vocabulary, never text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

function identity(net, p, a, n, label) {
  const row = net.roster().find(r => r.p === p);
  assert.ok(row, 'roster has P' + p);
  assert.equal(row.adjIdx, a); assert.equal(row.nounIdx, n);
  assert.equal(row.callsign, label);
  return row;
}

test('roster callsign indices survive roles and reconnects; reused seats have their new identity', async (t) => {
  const hub = relay(), peers = [];
  function make() { const c = client(hub, { game: false }); peers.push(c); return c; }
  t.after(() => peers.forEach(c => c.close()));
  const host = make(), guest = make(), watcher = make();
  await host.net.openRoom({ mode: 'race', relayHost: 'relay.test', code: false, adjIdx: 3, nounIdx: 1 });
  const invite = host.net.info().link.split('#j=')[1];
  await guest.net.acceptJoin(invite, { mode: 'race', adjIdx: 2, nounIdx: 0 });
  await watcher.net.acceptJoin(invite, { mode: 'race', role: 1 });
  await until(() => peers.every(c => c.net.roster().length === 3), 'complete identities');
  const gp = guest.net.info().myP, wp = watcher.net.info().myP;
  for (const c of peers) {
    identity(c.net, 1, 3, 1, 'NOVA OTTER');
    identity(c.net, gp, 2, 0, 'COMET FOX');
    identity(c.net, wp, 255, 255, 'P' + wp);
  }
  assert.equal(host.net._room.CALLSIGN_NONE, 255);
  const frozenSeat = identity(host.net, gp, 2, 0, 'COMET FOX');
  assert.equal(await guest.net.setRole(1), true);
  await until(() => watcher.net.roster().find(r => r.p === gp)?.spectator, 'spectator role propagated');
  for (const c of peers) identity(c.net, gp, 2, 0, 'COMET FOX');
  hub.advance(1600);
  assert.equal(await guest.net.setRole(0), true);
  const gs = guest.net._n1.session(), generation = gs.welcomeGen;
  gs.relay.kick('callsign reconnect test');
  await until(() => gs.welcomeGen > generation && peers.every(c => c.net.roster().length === 3), 'callsign reconnect', 8000);
  assert.equal(guest.net.info().myP, gp);
  for (const c of peers) identity(c.net, gp, 2, 0, 'COMET FOX');
  const hs = host.net._n1.session();
  guest.net.leave();
  await until(() => [...hs.roster.values()].find(r => r.p === gp)?.absent, 'old seat absent');
  hub.advance(15001); await hs._snapTick();
  const newcomer = make();
  await newcomer.net.acceptJoin(invite, { mode: 'race', adjIdx: 4, nounIdx: 5 });
  await until(() => watcher.net.roster().some(r => r.p === gp && r.adjIdx === 4), 'reused identity propagated');
  assert.equal(newcomer.net.info().myP, gp, 'retired P number is reused');
  for (const c of [host, watcher, newcomer]) identity(c.net, gp, 4, 5, 'COSMIC QUASAR');
  assert.equal(frozenSeat.adjIdx, 2); assert.equal(frozenSeat.nounIdx, 0);
  assert.equal(frozenSeat.callsign, 'COMET FOX', 'previous copied roster row is not rewritten');
});

test('default self identity and legacy guest fallback expose the no-callsign sentinel', async (t) => {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ mode: 'race', relayHost: 'relay.test', code: false });
  const invite = host.net.info().link.split('#j=')[1];
  await guest.net.acceptJoin(invite, { mode: 'race' });
  await until(() => guest.net.roster().some(r => r.you), 'default roster');
  identity(host.net, 1, 255, 255, 'P1');
  identity(guest.net, 1, 255, 255, 'P1');
  const gs = guest.net._n1.session();
  gs.rosterMap.clear(); gs.peers.set(7, {});
  identity(guest.net, 7, 255, 255, 'P7');
  gs.rosterMap.set(7, { role: 0 });
  identity(guest.net, 7, 255, 255, 'P7');
});
