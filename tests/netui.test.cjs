// Room flow on flaky or absent networks: honest states, no stuck spinners.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');
const nb = require('./netbench.cjs');

const shown = (c, id) => c.run(`$('${id}').classList.contains('show')`);
const el = (c, id) => c.elements.get(id);

test('offline: the title says single player is ready and Run Together explains itself without opening a socket', async (t) => {
  const hub = relay(), c = client(hub);
  t.after(() => c.close());
  c.context.navigator.onLine = false;
  c.run('G.cosmetics.callsign = [0, 0]; showAttract()');
  assert.equal(el(c, 'offlineNote').style.display, '', 'offline note visible');
  c.run("$('btnTogether').onclick()");
  assert.equal(shown(c, 'ovTogether'), true);
  assert.equal(el(c, 'btnCreateRoom').disabled, true);
  assert.equal(el(c, 'btnJoinGo').disabled, true);
  assert.match(el(c, 'joinHint').textContent, /offline.*single player works/i);
  const before = hub.packetCount;
  await c.run('openRoomFlow()');
  assert.equal(c.net.active, false, 'no room without a network');
  assert.equal(hub.packetCount, before);
  // Back online: the buttons come back and the hint resets.
  c.context.navigator.onLine = true;
  c.run('syncOffline()');
  assert.equal(el(c, 'btnCreateRoom').disabled, false);
  assert.doesNotMatch(el(c, 'joinHint').textContent, /offline/i);
  c.run('showAttract()');
  assert.equal(el(c, 'offlineNote').style.display, 'none');
});

test('opening a room keeps the front door up with a status line, and Back really cancels', async (t) => {
  const hub = nb.shape(relay()), c = client(hub);
  t.after(() => c.close());
  nb.setLink(c, { down: true });                           // relay never answers
  c.run("G.cosmetics.callsign = [0, 0]; $('btnTogether').onclick()");
  const opening = c.run('openRoomFlow()');
  await until(() => /Opening a room/.test(el(c, 'joinHint').textContent), 'status line');
  assert.equal(shown(c, 'ovTogether'), true, 'never a blank screen while the relay is found');
  assert.equal(el(c, 'btnCreateRoom').disabled, true);
  c.run("$('btnTogetherBack').onclick()");
  await opening;
  assert.equal(c.net.active, false);
  assert.equal(c.net._n1.session(), null, 'the half-open room is gone');
  assert.equal(shown(c, 'ovAttract'), true);
});

test('a join waiting on the host says so, and Cancel returns at once without a late surprise', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, approve: true });
  guest.run(`G.cosmetics.callsign = [0, 0]; joinPayload = ${JSON.stringify(host.net.info().link.split('#j=')[1])}; resetJoinPrompt(); showOverlay('ovJoin');`);
  const joining = guest.run('acceptInvite(0)');
  await until(() => /Waiting for the host/.test(el(guest, 'joinState').textContent), 'waiting-for-host stage');
  assert.equal(el(guest, 'btnJoinNotNow').textContent, 'Cancel');
  assert.notEqual(el(guest, 'btnJoinNotNow').style.display, 'none', 'Cancel stays reachable');
  guest.run("$('btnJoinNotNow').onclick()");
  await joining;
  assert.equal(guest.net.active, false);
  assert.equal(shown(guest, 'ovAttract'), true);
  assert.equal(guest.run('G.mode'), 'attract', 'no run started behind the person\'s back');
  assert.equal(el(guest, 'btnJoinNotNow').textContent, 'Not Now');
});

test('the room card shows an honest link line for guests and a per-member dot for the host', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.quality().level === 'good', 'first ping answered');
  guest.run('renderRoomCard()');
  assert.match(el(guest, 'roomRelay').innerHTML, /q-good">Good<\/span> · <span class="num">\d+ ms/);
  await until(() => host.net.quality().peers.length === 1, 'member report', 5000).catch(() => {});
  host.net._n1.session().roster.values().next().value.link = { n: 1, rtt: 420, loss: 0.12, jit: 30 };
  host.run('renderRoomCard()');
  assert.match(el(host, 'roomRelay').innerHTML, /q-poor">Poor/);
  const rows = el(host, 'roomRoster').children;
  assert.ok(rows.some((r) => r.children.some((s) => s.className === 'q q-poor' && s.textContent === 'Poor 420ms')), 'the member row carries its dot');
});

test('in a run, the link only speaks up when reconnecting or poor', async (t) => {
  const c = client(relay());
  t.after(() => c.close());
  const said = [];
  c.run('ctx.fillText = (s) => __said.push(String(s))'.replace('__said', 'globalThis.__said'));
  c.context.__said = said;
  for (const level of ['good', 'fair', 'poor', 'reconnecting']) {
    c.run(`NET.quality = () => ({ level: '${level}', rttMs: 480, lossPct: 0, jitterMs: 0, peers: [] }); drawLinkPill();`);
  }
  assert.deepEqual(said, ['WEAK LINK · 480 ms', 'RECONNECTING…']);
});
