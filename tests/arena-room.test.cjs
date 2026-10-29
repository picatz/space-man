// Coordinator API lifecycle tests. The real transport/crypto and arena authority
// run through the harness's simulated opaque relay; no UI behavior is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t) {
  const hub = relay(), clients = [];
  function peer() {
    const c = client(hub, { game: false }); clients.push(c);
    c.snapshots = []; c.changes = [];
    c.context.__snapshot = s => c.snapshots.push(s);
    c.context.__changed = s => c.changes.push(s);
    c.run(`window.room = SpaceManArenaRoom.create({net:SpaceManNet,
      hostOptions:()=>({relayHost:'relay.test',code:false}),
      onSnapshot:__snapshot,onChange:__changed});`);
    c.room = c.context.room;
    return c;
  }
  t.after(() => { for (const c of clients) { c.room.close(); c.close(); } });
  const host = peer();
  assert.equal(await host.room.hosting({ format: 'duel', arenaId: 'orbital-dock' }), true);
  const invite = host.net.info().link;
  async function join(role = 0) {
    const c = peer(); assert.equal(await c.room.join(invite, role), true);
    await until(() => c.room.current && c.net.roster().some(r => r.you), 'coordinator joined');
    return c;
  }
  async function step(count, guest, command = {}) {
    for (let i = 0; i < count; i++) {
      hub.advance(1000 / 60);
      if (guest) guest.room.step(command, hub.now());
      host.room.step({}, hub.now());
      // Exercise asynchronous encryption/transport between simulation turns.
      if (i % 3 === 0) await sleep(1);
    }
    await sleep(70);
  }
  return { hub, host, invite, peer, join, step };
}
const state = c => c.snapshots.at(-1)?.state;
const seat = (c, p) => c.room.current?.seats.find(s => s.p === p);

test('coordinator creates, joins, configures teams and closes over encrypted simulated relay', async t => {
  const { host, join, hub } = await setup(t), player = await join(), watcher = await join(1);
  await until(() => [host, player, watcher].every(c => c.net.roster().length === 3), 'shared roster');
  assert.equal(host.room.isHost, true); assert.equal(player.room.isHost, false);
  assert.equal(host.room.status().info.mode, 'arena');
  assert.equal(player.room.current.status, 'lobby');
  assert.equal(player.room.configure({ format: 'teams' }), false);
  assert.equal(player.room.start(1), false); assert.equal(player.room.lobby(), false);
  assert.equal(player.room.setTeam(1, 1), false);
  assert.equal(host.room.configure({ format: 'teams' }), true);
  await until(() => player.room.current.state.format === 'teams', 'team config');
  const p = player.net.info().myP;
  assert.equal(host.room.setTeam(p, 0), true);
  await until(() => seat(player, p)?.actorId === 2, 'host team selection');
  assert.equal(player.room.current.state.actors[1].team, 0);
  assert.equal(await watcher.room.role(0), true);
  await until(() => host.room.current.seats.length === 3, 'watcher promoted in lobby');
  hub.advance(1600); // Respect the transport's role-change debounce.
  assert.equal(await watcher.room.role(1), true);
  await until(() => host.room.current.seats.length === 2, 'watcher returned to watching');
  assert.ok(hub.packetCount > 20, 'real encrypted app packets crossed the simulated relay');
  host.room.close();
  await until(() => !player.room.active && !watcher.room.active, 'host BYE cleans up guests');
  for (const c of [host, player, watcher]) {
    assert.equal(c.net.active, false); assert.equal(c.room.current, null);
    assert.equal(c.room.busy, false);
  }
  assert.match(player.room.status().closedReason, /host closed/i);
  assert.equal(await host.room.hosting({ format: 'duel' }), true, 'coordinator can be reused after clean closure');
});

test('coordinator release, shared pause, late viewing, and same-identity reconnect preserve authority', { timeout: 20000 }, async t => {
  const { host, join, hub, step } = await setup(t), player = await join(), watcher = await join(1);
  const p = player.net.info().myP;
  assert.equal(host.room.start(17), true);
  await until(() => player.room.current.status === 'running', 'round begins');
  await step(185);
  assert.equal(state(host).phase, 'playing');
  const before = state(host).actors[1].x;
  // Delivery is asynchronous while these simulated host ticks run faster than
  // real time. Keep advancing until the delivered input can affect the actor;
  // sleeping after the final tick alone cannot demonstrate command handling.
  for (let attempts = 0; attempts < 12 && state(host).actors[1].x >= before - 5; attempts++) {
    await step(3, player, { moveX: -1 });
  }
  assert.ok(state(host).actors[1].x < before - 5, 'guest command drives only its host-owned fighter');
  player.room.release();
  await sleep(20); await step(45);
  assert.ok(Math.abs(state(host).actors[1].vx) < .1, 'released axes settle');
  assert.equal(player.room.pause(true), false, 'a guest menu cannot pause shared simulation');
  const tick = state(host).tick; await step(4);
  assert.ok(state(host).tick > tick);
  assert.equal(host.room.pause(true), true);
  await until(() => [player, watcher].every(c => c.room.current.status === 'paused'), 'shared pause');
  const paused = state(host).tick; await step(5);
  assert.equal(state(host).tick, paused);
  assert.equal(await watcher.room.role(0), false, 'match role lock rejects elevation');
  assert.equal(watcher.net.info().waiting, true, 'the request queues for the next lobby instead');
  assert.equal(await watcher.room.role(1), true, 'asking to watch leaves the queue');
  assert.equal(watcher.net.info().waiting, false);
  await until(() => !host.net.roster().some(r => r.waiting), 'host dropped the watcher from its queue');
  const late = await join(0);
  assert.equal(late.net.info().role, 1, 'new mid-match player is admitted as a viewer');
  assert.equal(late.net.info().waiting, true, 'and queued for a fighter');
  assert.equal(seat(late, late.net.info().myP), undefined);
  const key = player.net._n1.bytes.hex(player.net._n1.session().keys.pub);
  const actorId = seat(host, p).actorId, generation = player.net._n1.session().welcomeGen;
  player.net._n1.session().relay.kick('coordinator reconnect regression');
  await until(() => seat(host, p)?.connected === false, 'disconnected seat reserved');
  await until(() => player.net._n1.session().welcomeGen > generation && seat(host, p)?.connected, 'same identity reconnect', 9000);
  assert.equal(player.net.info().myP, p); assert.equal(player.net.info().role, 0);
  assert.equal(player.net._n1.bytes.hex(player.net._n1.session().keys.pub), key);
  assert.equal(seat(host, p).actorId, actorId);
  assert.equal(host.room.current.status, 'paused', 'reconnect cannot resume shared pause');
  assert.equal(host.room.pause(false), true); await step(5);
  await until(() => player.room.current.status === 'running', 'resume');
  assert.equal(host.room.lobby(), true);
  await until(() => [player, watcher, late].every(c => c.room.current.status === 'lobby'), 'return to shared lobby');
  assert.equal(late.net.info().role, 1, 'a full duel keeps the queued viewer watching');
  assert.equal(late.net.info().waiting, true);
  assert.equal(host.room.start(18), true, 'so a rematch still starts');
  assert.equal(host.room.lobby(), true);
  assert.equal(host.room.configure({ format: 'ffa' }), true);
  await until(() => late.net.info().role === 0, 'free-for-all seats the queued viewer');
  assert.equal(host.room.start(19), true);
  await until(() => late.room.current.seats.some(s => s.p === late.net.info().myP), 'new-round seat');
  assert.equal(host.room.current.state.actors.filter(a => a.controller === 'cpu').length, 1);
  assert.ok(hub.packetCount > 50);
});

test('invalid invites leave coordinator reusable without runner state', async t => {
  const { host, peer } = await setup(t), guest = peer();
  assert.equal(await guest.room.join('not an invite', 0), false);
  assert.equal(guest.room.active, false); assert.equal(guest.net.active, false);
  assert.match(guest.room.status().error, /invite|code/i);
  const runner = peer();
  await runner.net.openRoom({ relayHost: 'relay.test', code: false });
  assert.equal(await guest.room.join(runner.net.info().link, 0), false);
  assert.match(guest.room.status().error, /Run Together/i);
  assert.equal(guest.net.active, false);
  assert.equal(await guest.room.join(host.net.info().link, 1), true);
  guest.room.close();
  assert.equal(guest.room.status().error, ''); assert.equal(guest.room.status().connection, '');
  assert.equal(guest.room.current, null);
  assert.equal(await guest.room.hosting({ format: 'ffa' }), true);
});

test('coordinator cancel during directory lookup cannot resurrect or replace a retry room', async t => {
  const c = client(relay(), { game: false });
  let finish;
  c.context.SpaceManRelayDir = { load() { return new Promise(resolve => { finish = resolve; }); } };
  c.run(`window.directoryPending = true;
    window.room = SpaceManArenaRoom.create({net:SpaceManNet,
      hostOptions:()=>({relayHost:'relay.test',code:false,...(directoryPending?{relayDir:{mode:'custom'}}:{})})});`);
  const room = c.context.room;
  t.after(() => { room.close(); c.close(); });
  const old = room.hosting({ format: 'duel' });
  assert.equal(room.busy, true); assert.equal(c.net._n1.session(), null);
  room.close(); c.run('directoryPending = false');
  assert.equal(room.busy, false); assert.equal(room.active, false);
  assert.equal(await room.hosting({ format: 'teams' }), true);
  const retrySession = c.net._n1.session(), retryLink = c.net.info().link;
  finish({ source:'custom',map:{src:'cancelled-directory',regions:[{code:'nyc',city:'Cancelled',hosts:['old.test']}]}});
  assert.equal(await old, false, 'cancelled coordinator operation cannot claim success');
  assert.equal(c.net._n1.session(), retrySession);
  assert.equal(c.net.info().link, retryLink);
  assert.equal(c.net.active, true); assert.equal(room.active, true);
  assert.equal(room.current.state.format, 'teams'); assert.equal(room.status().error, '');
});

test('recycled player number never gives a late watcher a departed fighter', async t => {
  const { host, join } = await setup(t), player = await join();
  const p = player.net.info().myP;
  assert.equal(host.room.start(77), true);
  await until(() => player.room.current.status === 'running', 'arena starts');
  assert.equal(await host.net.kick(p), true);
  await until(() => !player.room.active && !seat(host, p).connected, 'departed fighter disconnected');
  const watcher = await join(1);
  assert.equal(watcher.net.info().myP, p, 'transport recycled the vacated player number');
  assert.equal(watcher.net.info().role, 1);
  assert.ok(state(watcher).actors.every(a => a.controller !== 'human'), 'watcher must keep watch controls rather than inherit the old fighter');
  assert.equal(state(host).actors.find(a => a.peerP === p).connected, false);
});

test('an Arena join explains how to open a Star Circuit invite', async t => {
  const { peer } = await setup(t), guest = peer(), racer = peer();
  await racer.net.openRoom({ relayHost: 'relay.test', code: false, mode: 'race' });
  assert.equal(await guest.room.join(racer.net.info().link, 0), false);
  assert.match(guest.room.status().error, /Star Circuit/);
  assert.equal(guest.net.active, false);
  assert.equal(guest.room.busy, false);
});

test('a guest who reloads mid-match comes back to the same fighter, and a deliberate leave forgets the seat', { timeout: 20000 }, async t => {
  const { host, join, peer, step } = await setup(t), player = await join();
  player.room.close(); // rebuild the guest coordinator with a resume store, as index.html wires it
  player.run(`window.__saved=[];window.room=SpaceManArenaRoom.create({net:SpaceManNet,resume:{save(){__saved.push(SpaceManNet.resumeToken());},clear(){__saved.push(null);}}});`);
  player.room = player.context.room;
  await until(() => host.net.roster().length === 1, 'deliberate leave freed the old seat');
  assert.equal(await player.room.join(host.net.info().link, 0), true);
  await until(() => host.net.roster().length === 2, 'rejoined');
  const token = JSON.parse(JSON.stringify(player.context.__saved.at(-1)));
  assert.equal(token.mode, 'arena'); assert.equal(token.host, false);
  const p = player.net.info().myP;
  assert.equal(host.room.start(5), true);
  await until(() => seat(host, p)?.connected, 'seated in the match');
  const actorId = seat(host, p).actorId;
  player.close(); // the tab reloads: no room.close, the socket just drops
  await until(() => seat(host, p)?.connected === false, 'seat reserved while away');
  const back = peer();
  assert.equal(await back.room.join(token.invite, token.role, true, token.priv), true);
  await until(() => seat(host, p)?.connected, 'same seat reconnected', 9000);
  assert.equal(back.net.info().myP, p); assert.equal(back.net.info().role, 0);
  assert.equal(seat(host, p).actorId, actorId, 'same fighter');
  await step(10);
  assert.equal(host.room.current.status, 'running', 'the match never stopped for anyone else');
});

test('a host who reloads gets the same room back in its lobby, and the crew is carried in without touching anything', { timeout: 30000 }, async t => {
  const { hub, host, join, peer } = await setup(t), player = await join();
  // Rebuild the host coordinator with a resume store, as index.html wires it.
  host.room.close(); await until(() => !player.room.active, 'old room closed');
  host.run(`window.__saved=[];window.room=SpaceManArenaRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false}),resume:{save(game){const t=SpaceManNet.resumeToken();__saved.push(t&&t.host?Object.assign({},t,{game}):t);},clear(){__saved.push(null);}}});`);
  host.room = host.context.room;
  assert.equal(await host.room.hosting({ format: 'ffa', arenaId: 'orbital-dock' }), true);
  const link = host.net.info().link;
  assert.equal(await player.room.join(link, 0), true);
  await until(() => host.net.roster().length === 2, 'crew joined');
  assert.equal(host.room.start(9), true);
  await until(() => player.room.current?.status === 'running', 'match running');
  const token = JSON.parse(JSON.stringify(host.context.__saved.at(-1)));
  assert.equal(token.host, true); assert.equal(token.mode, 'arena'); assert.equal(token.game.format, 'ffa');
  const s = host.net._n1.session(); if (s.snapTimer) s.snapTimer.stop(); s.relay.close();   // the tab is gone, nothing said
  const reborn = peer();
  reborn.run(`window.room=SpaceManArenaRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false})});`);
  reborn.room = reborn.context.room;
  assert.equal(await reborn.room.hosting(token.game, token), true);
  assert.equal(reborn.net.info().link, link, 'the invite everyone holds still works');
  assert.equal(reborn.room.current.state.format, 'ffa', 'saved rules come back');
  for (let i = 0; i < 400 && reborn.net.info().players < 2; i++) { hub.advance(300); await sleep(25); }
  assert.equal(reborn.net.info().players, 2, 'the guest found the restored host');
  await until(() => player.room.current?.status === 'lobby' && player.room.current.epoch === reborn.room.current.epoch, 'guest follows the restarted authority into its lobby');
  assert.equal(player.room.status().connection, '');
  assert.ok(reborn.room.current.seats.some(seat => seat.p === player.net.info().myP), 'seated as a fighter again');
  assert.equal(reborn.room.start(10), true);
  await until(() => player.room.current.status === 'running', 'next match starts for both');
});
