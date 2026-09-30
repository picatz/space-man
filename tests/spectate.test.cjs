const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function watcher(t) {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return guest;
}
// Put three runners on the field: p2 leads at 900 m, p3 at 500 m, p4 at 100 m.
function field(c) {
  c.run(`for (const g of ghosts) g.active = false; ghostByP.clear();
    for (const [p, dist] of [[4, 100], [2, 900], [3, 500]]) {
      const g = ghostFor(p); g.callsign = 'R' + p; g.dist = dist; g.inRun = true; g.dead = false;
      g.runId = NET.info().runId; g.lastSeen = netClock(); g.rx = g.x1 = dist * 10; g.alpha = 1;
    }
    spec.watchP = 0; spec.cutAt = 0; spec.tour = false;`);
}
const order = (c) => JSON.parse(c.run('JSON.stringify(spectateOrder().map((g) => g.p))'));

test('runners are ordered by the race, leader first, not by seat number', async (t) => {
  const c = await watcher(t); field(c);
  assert.deepEqual(order(c), [2, 3, 4]);
});

test('NEXT walks down the field and PREV back up it, wrapping, and either starts somewhere sensible', async (t) => {
  const c = await watcher(t); field(c);
  c.run('cycleWatch(1)'); assert.equal(c.run('spec.watchP'), 2, 'NEXT from nobody = the leader');
  c.run('cycleWatch(1)'); assert.equal(c.run('spec.watchP'), 3);
  c.run('cycleWatch(1)'); assert.equal(c.run('spec.watchP'), 4);
  c.run('cycleWatch(1)'); assert.equal(c.run('spec.watchP'), 2, 'wraps');
  c.run('cycleWatch(-1)'); assert.equal(c.run('spec.watchP'), 4, 'PREV from the leader wraps to the back');
  field(c);
  c.run('cycleWatch(-1)'); assert.equal(c.run('spec.watchP'), 4, 'PREV from nobody = the back of the field');
});

test('when the runner you follow goes down you stay on them for a beat, then cut to the leader', async (t) => {
  const c = await watcher(t); field(c);
  c.run('watchByP(3)');
  assert.equal(c.run('spectateTarget().p'), 3);
  c.run('ghostByP.get(3).dead = true');
  assert.equal(c.run('spectateTarget().p'), 3, 'their last moments are still on screen');
  assert.equal(c.run('spectateTarget().dead'), true);
  c.run('spec.cutAt = netClock() - 1');
  assert.equal(c.run('spectateTarget().p'), 2, 'then the leader');
  assert.equal(c.run('spec.cutAt'), 0);
});

test('tapping a runner on the race strip watches them; a dead runner cannot be picked', async (t) => {
  const c = await watcher(t); field(c);
  assert.equal(c.run('watchByP(4)'), true); assert.equal(c.run('spec.watchP'), 4);
  c.run('ghostByP.get(3).dead = true');
  assert.equal(c.run('watchByP(3)'), false); assert.equal(c.run('spec.watchP'), 4);
  assert.equal(c.run('watchByP(99)'), false);
});

test('the director cuts to whoever the flare is running down, else the leader', async (t) => {
  const c = await watcher(t); field(c);
  c.run('G.flare.x = -5000; directorPick(1e9)');
  assert.equal(c.run('spec.watchP'), 2, 'nothing dramatic: the leader');
  c.run('G.flare.x = ghostByP.get(4).rx - 50; directorPick(1e9)');
  assert.equal(c.run('spec.watchP'), 4, 'the straggler with the flare on their heels');
});
