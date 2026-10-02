// Real encrypted simulated relay + pure race authority, without a DOM mock.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { client, relay, until } = require("./harness.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(t) {
  const hub = relay(),
    clients = [];
  function peer() {
    const c = client(hub, { game: false });
    clients.push(c);
    c.snapshots = [];
    c.context.__snapshot = (s) => c.snapshots.push(s);
    c.run(
      `window.receivedRace=[];SpaceManNet.onEvent((event,data)=>{if(event==='race-data'){const c=SpaceManRaceOnline.decodeInput(data.bytes);if(c)receivedRace.push({p:data.p,...c});}});window.room=SpaceManRaceRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false}),identity:()=>({adjIdx:${clients.length},nounIdx:0}),onSnapshot:__snapshot});`,
    );
    c.room = c.context.room;
    return c;
  }
  t.after(() => {
    for (const c of clients) {
      c.room.close();
      c.close();
    }
  });
  const host = peer();
  assert.equal(
    await host.room.hosting({ trackId: "starlight", difficulty: "normal" }),
    true,
  );
  const invite = host.net.info().link;
  async function join(role = 0) {
    const c = peer();
    assert.equal(await c.room.join(invite, role), true);
    await until(
      () => c.room.current && c.net.roster().some((r) => r.you),
      "race joined",
    );
    return c;
  }
  async function step(n, guest, command = {}) {
    for (let i = 0; i < n; i++) {
      hub.advance(1000 / 60);
      if (guest) guest.room.step(command, hub.now());
      host.room.step({}, hub.now());
      if (i % 3 === 0) await sleep(1);
    }
    await sleep(70);
  }
  return { hub, host, invite, peer, join, step };
}
const state = (c) => c.snapshots.at(-1)?.state;
const seat = (c, p) => c.room.current?.seats.find((s) => s.p === p);
test("race coordinator creates, joins, watches, configures and closes through encrypted relay", async (t) => {
  const { host, join, hub } = await setup(t),
    player = await join(),
    watcher = await join(1);
  await until(
    () => [host, player, watcher].every((c) => c.net.roster().length === 3),
    "race roster",
  );
  assert.equal(host.room.status().info.mode, "race");
  assert.equal(player.room.current.status, "lobby");
  assert.equal(player.room.configure({ trackId: "bloom" }), false);
  assert.equal(player.room.start(), false);
  assert.equal(
    host.room.configure({ trackId: "bloom", difficulty: "hard" }),
    true,
  );
  await until(
    () => player.room.current.state.trackId === "bloom",
    "shared circuit",
  );
  assert.equal(host.room.current.state.actors.length, 5);
  assert.equal(host.room.current.seats.length, 2);
  assert.equal(await watcher.room.role(0), true);
  await until(() => host.room.current.seats.length === 3, "watcher joins grid");
  hub.advance(1600);
  assert.equal(await watcher.room.role(1), true);
  await until(
    () => host.room.current.seats.length === 2,
    "watcher leaves grid",
  );
  host.room.close();
  await until(
    () => !player.room.active && !watcher.room.active,
    "host closes race",
  );
  assert.match(player.room.status().closedReason, /host closed/i);
  assert.equal(await host.room.hosting({ trackId: "ember" }), true);
  assert.equal(host.room.current.state.trackId, "ember");
  assert.ok(hub.packetCount > 20);
});
test(
  "race release, pause, late watcher and same-identity reconnect preserve authoritative kart",
  { timeout: 20000 },
  async (t) => {
    const { host, join, hub, step } = await setup(t),
      player = await join(),
      watcher = await join(1),
      p = player.net.info().myP;
    assert.equal(host.room.start(), true);
    await until(() => player.room.current.status === "running", "race starts");
    await step(185);
    assert.equal(state(host).phase, "racing");
    const id = seat(host, p).actorId,
      actor = () => state(host).actors.find((a) => a.id === id),
      before = actor().x;
    await step(20, player, { throttle: 1 });
    assert.ok(
      actor().x > before + 5,
      "guest commands move its host-owned kart",
    );
    const seq=seat(host,p).seq;
    player.room.release();
    await until(()=>host.context.receivedRace.some(c=>c.p===p&&c.seq>seq&&c.command.throttle===0),'neutral release packet');
    await step(50);
    const released=host.context.receivedRace.filter(c=>c.p===p).at(-1);
    assert.equal(released.command.throttle,0);
    assert.equal(released.command.steer,0);
    assert.equal(released.command.boost,false);
    assert.ok(seat(host,p).seq>=released.seq,'host acknowledges neutral input');
    assert.equal(player.room.pause(true), false);
    const tick = state(host).tick;
    await step(4);
    assert.ok(state(host).tick > tick);
    assert.equal(host.room.pause(true), true);
    await until(
      () => [player, watcher].every((c) => c.room.current.status === "paused"),
      "shared pause",
    );
    const paused = state(host).tick;
    await step(4);
    assert.equal(state(host).tick, paused);
    assert.equal(await watcher.room.role(0), false);
    const late = await join();
    assert.equal(late.net.info().role, 1);
    const generation = player.net._n1.session().welcomeGen;
    player.net._n1.session().relay.kick("race reconnect regression");
    await until(
      () => seat(host, p)?.connected === false,
      "race seat disconnected",
    );
    await until(
      () =>
        player.net._n1.session().welcomeGen > generation &&
        seat(host, p)?.connected,
      "race seat returns",
      9000,
    );
    assert.equal(seat(host, p).actorId, id);
    assert.equal(host.room.current.status, "paused");
    assert.equal(host.room.pause(false), true);
    await step(4);
    await until(() => player.room.current.status === "running", "race resumes");
    assert.equal(host.room.lobby(), true);
    await until(() => late.room.current.status === "lobby", "next grid");
    assert.equal(await late.room.role(0), true);
    await until(
      () => host.room.current.seats.length === 3,
      "new racer assigned",
    );
  },
);
test("wrong-mode and malformed race invitations fail cleanly and room can retry", async (t) => {
  const { host, peer } = await setup(t),
    guest = peer(),
    runner = peer();
  assert.equal(await guest.room.join("invalid input", 0), false);
  assert.match(guest.room.status().error, /invite|code/i);
  await runner.net.openRoom({ relayHost: "relay.test", code: false });
  assert.equal(await guest.room.join(runner.net.info().link, 0), false);
  assert.match(guest.room.status().error, /Run Together/i);
  assert.equal(guest.net.active, false);
  assert.equal(await guest.room.join(host.net.info().link, 1), true);
  guest.room.close();
  assert.equal(guest.room.current, null);
  assert.equal(guest.net.resumeToken(), null);
});
test("cancelled race directory lookup cannot replace a retry session", async (t) => {
  const c = client(relay(), { game: false });
  let finish;
  c.context.SpaceManRelayDir = {
    load() {
      return new Promise((r) => {
        finish = r;
      });
    },
  };
  c.run(
    `window.pending=true;window.room=SpaceManRaceRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false,...(pending?{relayDir:{mode:'custom'}}:{})})});`,
  );
  const room = c.context.room;
  t.after(() => {
    room.close();
    c.close();
  });
  const old = room.hosting({ trackId: "starlight" });
  assert.equal(room.busy, true);
  room.close();
  c.run("pending=false");
  assert.equal(await room.hosting({ trackId: "ember" }), true);
  const session = c.net._n1.session();
  finish({
    source: "custom",
    map: {
      src: "cancelled",
      regions: [{ code: "nyc", city: "Old", hosts: ["old.test"] }],
    },
  });
  assert.equal(await old, false);
  assert.equal(c.net._n1.session(), session);
  assert.equal(room.current.state.trackId, "ember");
});


test('late watcher reusing a departed peer number keeps spectator ownership and frozen names', {timeout:20000},async t=>{
  const {host,join,hub,step}=await setup(t),player=await join(),watcher=await join(1);
  const p=player.net.info().myP;
  host.room.start();await until(()=>player.room.current.status==='running','race starts');await step(185);
  const oldName=state(host).actors.find(a=>a.peerP===p).name;
  player.room.close();await until(()=>!host.net.roster().some(r=>r.p===p),'original racer leaves');
  hub.advance(16001);await sleep(1600);await step(2);
  const late=await join(1);assert.equal(late.net.info().myP,p,'vacant P number is reused');
  await until(()=>late.snapshots.length>0,'late watcher snapshot');
  assert.ok(state(late).actors.every(a=>a.controller!=='human'),'watcher never inherits old kart');
  assert.equal(state(late).actors.find(a=>a.peerP===p).name,oldName,'old name remains frozen');
  assert.notEqual(oldName,late.net.roster().find(r=>r.you).callsign,'new watcher has different callsign');
});
