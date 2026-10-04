const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { client, relay, until } = require('./harness.cjs');
const source = fs.readFileSync(require.resolve('../src/net.js'), 'utf8');
const revisions = { race: { name: 'RACE', old: 11, current: 13, mode: 2, detail: 32 }, journey: { name: 'JOURNEY', old: 12, current: 14, mode: 3, detail: 64 } };
function peer(hub, mode, old = false) {
  const c = client(hub, { game: false });
  if (old) { const r = revisions[mode], from = `const CAP_${r.name} = 1 << ${r.current},`;
    assert.ok(source.includes(from)); c.run(source.replace(from, `const CAP_${r.name} = 1 << ${r.old},`)); c.net = c.context.SpaceManNet; }
  return c;
}
async function setup(t, mode, old = false, approve = false) {
  const hub = relay(), h = peer(hub, mode, old), g = peer(hub, mode, old);
  t.after(() => { h.close(); g.context.room?.close?.(); g.context.room?.leave?.(); g.close(); });
  await h.net.openRoom({ relayHost: 'relay.test', code: false, mode, approve });
  return { h, g, hub, invite: h.net.info().link.split('#j=')[1] };
}
for (const oldHost of [false, true]) for (const role of [0, 1]) test(`journey HELLO rejects ${oldHost ? 'new' : 'old'} ${role ? 'watcher' : 'player'} before any encounter`, async t => {
  const { h, g, hub, invite } = await setup(t, 'journey', oldHost); g.close(); const opposite = peer(hub, 'journey', !oldHost); t.after(() => opposite.close());
  await assert.rejects(opposite.net.acceptJoin(invite, { mode: 'journey', role }), /newer expedition version.*Leave the room, refresh all games.*new invite/);
  assert.equal(h.net._n1.session().roster.size, 0); assert.equal(opposite.net.active, false); assert.equal(opposite.net._n1.session(), null);
});
for (const mode of ['race', 'journey']) for (const old of [false, true]) for (const role of [0, 1]) {
  const r = revisions[mode], incompatible = 1 << (old ? r.current : r.old);
  test(`${mode} ${old ? 'legacy' : 'current'} held approval revalidates ${role ? 'watcher' : 'player'} capability before seat assignment`, async t => {
    const { h, g, invite } = await setup(t, mode, old, true);
    const joining = g.net.acceptJoin(invite, { mode, role }); const rejection = assert.rejects(joining, /version.*refresh all games.*new invite/);
    const hs = h.net._n1.session(); await until(() => hs.pending.size === 1, 'held join');
    const [key, pending] = [...hs.pending][0]; pending.h.caps = h.net._room.CAPS | incompatible;
    assert.equal(await h.net.approve(key, true), false); await rejection;
    assert.equal(hs.pending.size, 0); assert.equal(hs.roster.size, 0); assert.equal(g.net._n1.session(), null);
  });
  test(`${mode} ${old ? 'legacy' : 'current'} reconnect revalidates ${role ? 'watcher' : 'player'} and retires incompatible ownership`, async t => {
    const { h, g, hub, invite } = await setup(t, mode, old); await g.net.acceptJoin(invite, { mode, role });
    const hs = h.net._n1.session(), gs = g.net._n1.session(), api = h.net._n1, row = hs.roster.get(api.bytes.hex(gs.keys.pub));
    let rejection; g.net.onEvent('bye', data => { rejection = data; }); hub.advance(6000);
    const b = api.frames.encHello(api.frames.makeScratch(), { tag: 'REJ', role, mode: r.mode, caps: h.net._room.CAPS | incompatible, proof16: row.proof }).slice();
    await hs._onPacket(gs.keys.pub, await g.net._n1.env.sealApp(gs.pair, b));
    await until(() => rejection, 'rejoin rejected'); assert.equal(rejection.reason, 3); assert.equal(rejection.detail, r.detail);
    assert.equal(hs.roster.size, 0); assert.equal(await (mode === 'race' ? g.net.sendRace(new Uint8Array([2])) : g.net.sendJourney(new Uint8Array([2]))), false);
  });
  test(`${mode} ${old ? 'legacy' : 'current'} WELCOME revalidation closes ${role ? 'watcher' : 'player'} coordinator cleanly`, async t => {
    const { h, g } = await setup(t, mode, old);
    g.run(`window.room=SpaceMan${mode === 'race' ? 'Race' : 'Journey'}Room.create({net:SpaceManNet});`);
    assert.equal(await g.context.room.join(h.net.info().link, role), true);
    const hs = h.net._n1.session(), gs = g.net._n1.session(), api = h.net._n1, row = hs.roster.get(api.bytes.hex(gs.keys.pub));
    const b = api.frames.encWelcome(api.frames.makeScratch(), { yourP: row.p, seed: hs.seed, runId: hs.runId, epoch: hs.epoch, hostTag: hs.tag,
      mode: r.mode, caps: h.net._room.CAPS | incompatible, playerCap: 4, spectatorCap: 4 }).slice();
    await gs._onPacket(hs.keys.pub, await api.env.sealApp(row.pair, b));
    assert.equal(g.context.room.active, false); assert.equal(g.context.room.busy, false); assert.equal(g.net.active, false); assert.equal(g.net._n1.session(), null);
    assert.match(g.context.room.status().closedReason, /version.*Leave the room, refresh all games.*new invite/);
  });
}

test('race and journey advertise only their own atomic capability; runner/Arena and appearance remain independent', async t => {
  for (const mode of ['runner', 'arena', 'race', 'journey']) {
    const hub = relay(), c = peer(hub); t.after(() => c.close());
    await c.net.openRoom({ relayHost: 'relay.test', code: false, mode });
    const caps = c.net.info().caps, modeCap = mode === 'race' ? 1 << 13 : mode === 'journey' ? 1 << 14 : mode === 'arena' ? 1 << 5 : 0;
    assert.equal(caps, 0x1f | (1 << 10) | modeCap); assert.equal(c.net._n1.PROTO, 6);
    assert.equal(caps & ((1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 11) | (1 << 12)), 0);
  }
});
