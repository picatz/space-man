const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

const named = (c) => c.run('G.cosmetics.callsign = [0, 0]; persistAll()');

test('a host who reloads gets the same room back, with the same link', async (t) => {
  const hub = relay(), session = new Map(), storage = new Map();
  const host = client(hub, { session, storage }); named(host);
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const link = host.net.info().link;
  host.run('saveResume()');
  assert.ok(session.get('sm2.resume'), 'the token is kept for the tab');
  host.close();                                         // reload: the old page is gone, the tab's session storage stays
  const again = client(hub, { session, storage });
  t.after(() => again.close());
  await until(() => again.net.active, 'room restored');
  assert.equal(again.net.info().link, link);
  assert.equal(again.net.info().isHost, true);
  assert.equal(again.run("$('ovRoom').classList.contains('show')"), true, 'lands on the room card, not the title');
});

test('a guest who reloads is seated in the same place and lands back in the run', async (t) => {
  const hub = relay(), host = client(hub), session = new Map(), storage = new Map();
  t.after(() => host.close());
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const payload = host.net.info().link.split('#j=')[1];
  const g1 = client(hub, { session, storage }); named(g1);
  await g1.net.acceptJoin(payload, { adjIdx: 1, nounIdx: 1 });
  g1.run('saveResume()');
  const seat = g1.net.info().myP;
  g1.close();
  const g2 = client(hub, { session, storage });
  t.after(() => g2.close());
  hub.advance(6000);   // the host rate-limits a key's hellos to one per 5 s; a reload is usually slower than that anyway
  await until(() => g2.net.active, 'guest back in');
  assert.equal(g2.net.info().myP, seat);
  assert.equal(host.net.info().players, 2, 'no ghost seat left behind');
});

test('leaving on purpose clears the token, so a reload does not drag you back', async (t) => {
  const hub = relay(), session = new Map(), storage = new Map();
  const host = client(hub, { session, storage }); named(host);
  t.after(() => host.close());
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  host.run('saveResume()');
  assert.ok(session.get('sm2.resume'));
  host.run('leaveRoom()');
  assert.equal(session.get('sm2.resume'), undefined);
});

test('an invite to somebody else’s room beats a saved one, and a dead token is dropped', async (t) => {
  const hub = relay(), session = new Map(), storage = new Map();
  const other = client(hub); t.after(() => other.close());
  await other.net.openRoom({ relayHost: 'relay.test', code: false });
  const theirs = other.net.info().link.split('#j=')[1];
  const mine = client(hub, { session, storage }); named(mine);
  await mine.net.openRoom({ relayHost: 'relay.test', code: false });
  mine.run('saveResume()'); mine.close();
  const again = client(hub, { session, storage, hash: '#j=' + theirs }); t.after(() => again.close());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(again.net.active, false, 'did not silently re-host over a friend’s invite');
  assert.equal(session.get('sm2.resume'), undefined, 'the stale token is gone');
  assert.equal(again.run("$('ovJoin').classList.contains('show')"), true, 'the join prompt shows instead');
  session.set('sm2.resume', JSON.stringify({ v: 1, host: true, pub: 'aa', priv: 'zz', expiryMin: 1 }));
  const expired = client(hub, { session, storage }); t.after(() => expired.close());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(expired.net.active, false);
  assert.equal(session.get('sm2.resume'), undefined, 'an expired room token is cleared');
});

test('closing the tab on a crowd asks first; an empty room does not nag', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  assert.equal(host.run('otherMembers()'), 0);
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], {});
  await until(() => host.net.info().players === 2, 'guest counted');
  assert.equal(host.run('otherMembers()'), 1);
  host.context.window.confirm = () => false;
  host.run('globalThis.__left = false; const l = leaveRoom; leaveRoom = () => { __left = true; }; requestLeaveRoom(); leaveRoom = l;');
  assert.equal(host.run('__left'), false, 'declining the confirm keeps the room');
  host.context.window.confirm = () => true;
  host.run('const l2 = leaveRoom; leaveRoom = () => { __left = true; }; requestLeaveRoom(); leaveRoom = l2;');
  assert.equal(host.run('__left'), true);
});
