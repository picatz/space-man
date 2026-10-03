// Admission compatibility across race geometry revisions. The legacy fixture
// changes only the advertised/required capability; HELLO/WELCOME shapes and
// capability gates are the same ones used by the original race transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { client, relay, until } = require('./harness.cjs');
const source = fs.readFileSync(require.resolve('../src/net.js'), 'utf8');
function peer(hub, legacy = false) {
  const c = client(hub, { game: false });
  if (legacy) {
    assert.ok(source.includes('const CAP_RACE = 1 << 8,'), 'fixture tracks the current exclusive race capability');
    c.run(source.replace('const CAP_RACE = 1 << 8,', 'const CAP_RACE = 1 << '+(legacy === true ? 7 : legacy)+','));
    c.net = c.context.SpaceManNet;
  }
  return c;
}
for (const revision of [6,7]) for (const hostLegacy of [false,true]) for (const role of [0,1]) {
  test(`legacy bit ${revision}: ${hostLegacy?'legacy':'current'} race host rejects ${hostLegacy?'current':'legacy'} ${role?'spectator':'player'} before admission`, async t => {
    const hub = relay(), host = peer(hub,hostLegacy ? revision : false), guest = peer(hub,hostLegacy ? false : revision);
    t.after(() => { host.close(); guest.close(); });
    await host.net.openRoom({ relayHost:'relay.test',code:false,mode:'race' });
    assert.notEqual(host.net._room.caps.CAP_RACE,guest.net._room.caps.CAP_RACE);
    await assert.rejects(guest.net.acceptJoin(host.net.info().link.split('#j=')[1],{mode:'race',role}), /version.*Refresh both games/i);
    assert.equal(host.net.roster().length,1,'no mixed-geometry peer is admitted');
    assert.equal(host.net._n1.session().roster.size,0);
    assert.equal(guest.net.active,false);
    assert.equal(guest.net._n1.session(),null,'rejected join releases its session');
  });
}

test('race coordinator shows actionable update instructions for a legacy host', async t => {
  const hub = relay(), host = peer(hub,true), guest = peer(hub);
  t.after(() => { host.close(); guest.context.room?.close(); guest.close(); });
  await host.net.openRoom({ relayHost:'relay.test',code:false,mode:'race' });
  guest.run('window.room=SpaceManRaceRoom.create({net:SpaceManNet});');
  assert.equal(await guest.context.room.join(host.net.info().link,0),false);
  assert.match(guest.context.room.status().error,/incompatible race version.*Refresh both games.*new invite/i);
  assert.equal(guest.context.room.busy,false);
  assert.equal(guest.context.room.active,false);
  assert.equal(guest.net.active,false);
});

test('same revision race players and watchers still join, while runner and Arena caps stay unchanged', async t => {
  const hub = relay(), host = peer(hub), player = peer(hub), watcher = peer(hub);
  t.after(() => { host.close(); player.close(); watcher.close(); });
  assert.equal(host.net._room.CAPS & ~host.net._room.caps.CAP_APPEARANCE,0x1f);
  assert.equal(host.net._room.caps.CAP_APPEARANCE,1<<10);
  assert.equal(host.net._room.caps.CAP_ARENA,1<<5);
  assert.equal(host.net._n1.PROTO,6);
  assert.equal(host.net._room.caps.CAP_RACE,1<<8);
  await host.net.openRoom({ relayHost:'relay.test',code:false,mode:'race' });
  assert.equal(host.net.info().caps & ((1<<6)|(1<<7)),0,'new geometry must not claim legacy compatibility');
  const invite = host.net.info().link.split('#j=')[1];
  await player.net.acceptJoin(invite,{mode:'race',role:0});
  await watcher.net.acceptJoin(invite,{mode:'race',role:1});
  await until(() => [host,player,watcher].every(c=>c.net.roster().length===3),'same-version roster');
  assert.equal(player.net.info().role,0); assert.equal(watcher.net.info().role,1);
});

test('current race client rejects a legacy WELCOME even after a compatible admission', async t => {
  const hub = relay(), host = peer(hub), guest = peer(hub);
  t.after(() => { host.close(); guest.context.room?.close(); guest.close(); });
  await host.net.openRoom({ relayHost:'relay.test',code:false,mode:'race' });
  guest.run('window.room=SpaceManRaceRoom.create({net:SpaceManNet});');
  assert.equal(await guest.context.room.join(host.net.info().link,0),true);
  const hs=host.net._n1.session(),gs=guest.net._n1.session(),api=host.net._n1;
  const row=hs.roster.get(api.bytes.hex(gs.keys.pub));
  const legacy=api.frames.encWelcome(api.frames.makeScratch(),{
    yourP:row.p,seed:hs.seed,runId:hs.runId,epoch:hs.epoch,hostTag:hs.tag,
    mode:2,caps:host.net._room.CAPS|(1<<7),playerCap:4,spectatorCap:4,
  }).slice();
  await gs._onPacket(hs.keys.pub,await api.env.sealApp(row.pair,legacy));
  assert.equal(guest.context.room.active,false,'WELCOME mismatch ends the incompatible room');
  assert.equal(guest.net.active,false);
  assert.match(guest.context.room.status().closedReason,/incompatible race version.*Refresh both games.*new invite/i);
  assert.equal(await guest.net.sendRace(new Uint8Array([1,1])),false);
});
