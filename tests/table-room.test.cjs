// Constellations over Play Together: the real transport and encrypted relay
// (harness hub), the host-owned match and its validation of guest requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function setup(t) {
  const hub = relay(), clients = [];
  function peer() {
    const c = client(hub, { game: false }); clients.push(c);
    c.run(`window.room = SpaceManTableRoom.create({net:SpaceManNet, seed:()=>7,
      hostOptions:()=>({relayHost:'relay.test',code:false})});`);
    c.room = c.context.room;
    return c;
  }
  t.after(() => { for (const c of clients) { c.room.close(); c.close(); } });
  const host = peer();
  assert.equal(await host.room.hosting(), true);
  const invite = host.net.info().link;
  async function join(role = 0) {
    const c = peer(); assert.equal(await c.room.join(invite, role), true);
    await until(() => c.net.roster().some(r => r.you), 'joined');
    return c;
  }
  return { hub, host, join };
}
const turn = c => c.room.match && c.context.SpaceManTabletop.LANTERNS.turn(c.room.match.state);

test('host and guest play a full Constellations match and a rematch over the encrypted relay', async t => {
  const { host, join } = await setup(t);
  assert.equal(host.room.status().info.mode, 'table');
  assert.equal(host.room.match, null, 'no match until a rival sits down');
  const guest = await join();
  await until(() => guest.room.match && guest.room.status().mySeat === 2, 'guest seated with the match');
  assert.equal(host.room.status().mySeat, 1);
  // Out of turn and illegal requests change nothing.
  assert.equal(turn(host), 1);
  assert.equal(guest.room.play(0), false);
  // Seat 1 lights the top row while seat 2 answers in the middle row: 0,3,1,4,2 wins round 1.
  const script = [[host, 0], [guest, 3], [host, 1], [guest, 4], [host, 2]];
  for (const [who, cell] of script) {
    await until(() => turn(who) === (who === host ? 1 : 2) && who.room.match.phase === 'playing', 'turn reached ' + cell);
    assert.equal(who.room.play(cell), true, 'move ' + cell);
    await until(() => host.room.match.last === cell && guest.room.match.last === cell, 'both see ' + cell);
  }
  assert.equal(guest.room.match.phase, 'round');
  assert.deepEqual([...guest.room.match.scores], [1, 0]);
  assert.deepEqual([...guest.room.match.result.line], [0, 1, 2]);
  // The next round starts by itself, and the loser (seat 2) lights first.
  await until(() => guest.room.match.round === 2 && guest.room.match.phase === 'playing', 'round 2', 5000);
  assert.equal(turn(guest), 2);
  for (const [who, cell] of [[guest, 0], [host, 3], [guest, 1], [host, 4], [guest, 2]]) {
    await until(() => turn(who) === (who === host ? 1 : 2), 'turn ' + cell);
    assert.equal(who.room.play(cell), true);
    await until(() => host.room.match.last === cell && guest.room.match.last === cell && host.room.match.state.ply === guest.room.match.state.ply, 'sync ' + cell);
  }
  await until(() => guest.room.match.round === 3 && guest.room.match.phase === 'playing', 'round 3', 5000);
  assert.equal(turn(host), 1, 'seat 1 lost round 2, so it starts round 3');
  for (const [who, cell] of [[host, 6], [guest, 0], [host, 7], [guest, 1], [host, 8]]) {
    await until(() => turn(who) === (who === host ? 1 : 2), 'turn ' + cell);
    assert.equal(who.room.play(cell), true);
    await until(() => host.room.match.last === cell && guest.room.match.last === cell && host.room.match.state.ply === guest.room.match.state.ply, 'sync ' + cell);
  }
  assert.equal(guest.room.match.phase, 'over');
  assert.deepEqual([...guest.room.match.scores], [2, 1]);
  // Rematch needs both pilots.
  assert.equal(guest.room.rematch(), true);
  await until(() => host.room.status().ready === 2, 'host sees the guest ready');
  assert.equal(host.room.match.phase, 'over');
  assert.equal(host.room.rematch(), true);
  await until(() => guest.room.match.phase === 'playing' && guest.room.match.round === 1, 'rematch');
  assert.deepEqual([...guest.room.match.scores], [0, 0]);
});

test('watchers see the board but cannot move, and a freed seat goes to the next pilot', async t => {
  const { host, join } = await setup(t);
  const guest = await join(), watcher = await join(1);
  await until(() => watcher.room.match && guest.room.status().mySeat === 2, 'seated');
  assert.equal(watcher.room.status().mySeat, 0);
  assert.equal(host.room.play(4), true);
  await until(() => watcher.room.match.last === 4, 'watcher sees the move');
  assert.equal(watcher.room.play(0), false);
  // A rival who drops keeps the seat through the reload grace; one who is removed frees it at once.
  await host.net.kick(guest.net.info().myP);
  await until(() => host.room.status().seats[1] === 0, 'seat freed');
  assert.equal(host.room.match.last, 4, 'the board is kept for the next rival');
  const next = await join();
  await until(() => next.room.status().mySeat === 2 && next.room.match && next.room.match.last === 4, 'new rival takes over the board');
  assert.equal(next.room.play(0), true);
  await until(() => host.room.match.last === 0, 'host accepts the new rival');
});
