// Joining under real-world phone conditions: the host's phone locks or switches apps while it
// shows the invite, its network changes under an open socket, or its first relay node is out of
// reach. Each case runs the real game modules and the real encrypted protocol through the
// in-memory relay (tests/harness.cjs), shaped by tests/netbench.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');
const nb = require('./netbench.cjs');

const invite = (host) => host.net.info().link.split('#j=')[1];
const fast = (c, tune) => Object.assign(c.net._n1.TUNE, tune);

test('a host whose socket died silently (network switch, no FIN) notices on its own and a waiting friend gets in', { timeout: 30000 }, async (t) => {
  const hub = nb.shape(relay()), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  fast(host, { relayTickMs: 100 });                       // a quicker sweep; the rule is the same
  fast(guest, { joinSlowMs: 300 });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  const before = host.net._n1.session().relay.ws;
  await nb.blackhole(host, 50, { dead: true });           // the host's socket still reads OPEN but carries nothing
  const stages = [];
  guest.net.onEvent((e, d) => { if (e === 'join-progress') stages.push(d.stage); });
  const joined = guest.net.acceptJoin(invite(host), { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.joinStatus()?.stage === 'slow', 'the join screen says why it is still waiting', 3000);
  assert.match(guest.net.joinStatus().text, /keep Space Man open/);
  await until(() => host.net._n1.session().relay.ws !== before && host.net._n1.session().relay.state === 'established', 'the host replaced its dead socket', 3000);
  await joined;                                           // the guest's next knock lands on the new socket
  assert.equal(guest.net.info().myP, 2);
  assert.equal(guest.net.joinStatus(), null, 'nothing left to wait for once admitted');
  assert.deepEqual(stages.slice(0, 3), ['relay', 'hello', 'slow']);
});

test('a phone back from the lock screen makes its open socket prove itself at once', { timeout: 15000 }, async (t) => {
  const hub = nb.shape(relay()), host = client(hub, { game: false });
  t.after(() => host.close());
  fast(host, { resumeProbeMs: 200 });                     // the sweep stays at its 5 s default: only the probe can catch this
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  const rc = host.net._n1.session().relay, before = rc.ws;
  host.net.nudge();                                       // a healthy socket answers the probe and is kept
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(rc.ws, before, 'a live socket is never replaced by a resume check');
  await nb.blackhole(host, 20, { dead: true });
  host.net.nudge();                                       // tab visible again (visibilitychange / pageshow / online)
  await until(() => rc.ws !== before && rc.state === 'established', 'a stale socket was replaced within the probe window', 2500);
});

test('a join to a host whose game is offline says so, keeps knocking, and gets in when the host comes back', { timeout: 30000 }, async (t) => {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  hub.notHere = true;                                     // the relay answers a send to an absent key with PeerGone
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  // The host's phone locks: its socket closes and the page cannot reconnect until it is woken.
  const rc = host.net._n1.session().relay;
  host.link.down = true;
  const ws = rc.ws; ws.close(); ws.onclose?.();           // the relay drops it (the in-memory socket fires no close itself)
  await until(() => rc.state !== 'established', 'host off the relay');
  let settled = false;
  const joined = guest.net.acceptJoin(invite(host), { adjIdx: 1, nounIdx: 1 }).finally(() => { settled = true; });
  await until(() => guest.net.joinStatus()?.stage === 'away', 'the join screen says the host is offline', 3000);
  assert.match(guest.net.joinStatus().text, /offline/);
  assert.match(guest.net.joinStatus().text, /get in automatically/);
  assert.equal(settled, false, 'an away host does not fail the join');
  host.link.down = false;                                 // the host opens Space Man again
  await until(() => { host.net.nudge(); return rc.state === 'established'; }, 'host back on the relay', 12000);
  await joined;
  assert.equal(guest.net.info().myP, 2);
});

test('a host whose first relay node is unreachable opens on the next one, and a guest finds it', { timeout: 20000 }, async (t) => {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  const region = host.net._n1.map.regionOf('nyc');
  const blocked = (url) => url.includes(region.hosts[0]);
  host.link.refuse = blocked; guest.link.refuse = blocked;
  fast(host, { hostConnectMs: 300 }); fast(guest, { joinConnectMs: 300 });
  await host.net.openRoom({ region: 'nyc', code: false, adjIdx: 0, nounIdx: 0 });
  assert.equal(host.net._n1.session().relayHostName, region.hosts[1]);
  await guest.net.acceptJoin(invite(host), { adjIdx: 1, nounIdx: 1 });
  assert.equal(guest.net.info().myP, 2);
});

test('a room keeps the screen awake, asks again when the tab comes back, and lets go on leave', async (t) => {
  const calls = [];
  const lock = () => { const l = { released: false, release: async () => { l.released = true; calls.push('release'); }, addEventListener() {} }; return l; };
  const wakeLock = { request: async (type) => { calls.push(type); return lock(); } };
  const hub = relay(), host = client(hub, { game: false, navigator: { wakeLock } });
  t.after(() => host.close());
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  await until(() => calls.includes('screen'), 'wake lock requested');
  host.net.nudge();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.filter((c) => c === 'screen').length, 1, 'a held lock is not requested twice');
  host.net.leave();
  await until(() => calls.includes('release'), 'released on leave');
});

test('Arena and Star Circuit join screens say what the join waits for, in the same words as Run', { timeout: 20000 }, async (t) => {
  const hub = relay(), clients = [];
  t.after(() => { for (const c of clients) { c.room.close(); c.close(); } });
  for (const [api, rules] of [['SpaceManArenaRoom', { format: 'duel', arenaId: 'orbital-dock' }], ['SpaceManRaceRoom', null]]) {
    const peer = () => {
      const c = client(hub, { game: false }); clients.push(c);
      c.changes = []; c.context.__changed = (s) => c.changes.push(s);
      c.run(`window.room = ${api}.create({net:SpaceManNet, hostOptions:()=>({relayHost:'relay.test',code:false}), onSnapshot(){}, onChange:__changed});`);
      c.room = c.context.room;
      return c;
    };
    const host = peer(), guest = peer();
    assert.equal(await host.room.hosting(rules || undefined), true, api + ' room opened');
    fast(guest, { joinSlowMs: 200 });
    hub.admissionPaused = true;                            // the host's game is not answering yet
    const joined = guest.room.join(host.net.info().link, 0);
    await until(() => /keep Space Man open/.test(guest.room.status().joinText), api + ': the waiting reason reaches the room status', 3000);
    assert.ok(guest.changes.some((s) => /Asking the host/.test(s.joinText)), api + ': each stage re-renders the screen');
    hub.admissionPaused = false;
    assert.equal(await joined, true, api + ': the join still lands once the host answers');
    assert.equal(guest.room.status().joinText, '');
    host.room.close(); guest.room.close();
  }
});
