// Review round 4 on PR #17: pre-restart samples never apply after a restart; older PINGs
// never overwrite a newer link report.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function room(t) {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'roster');
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  clearInterval(hs.snapTimer); clearInterval(gs.pingTimer);
  return { hub, host, guest, hs, gs, row: [...hs.roster.values()][0] };
}
const pres = (runId, t, x, state) => ({ t, x, y: 250, vx: 0, vy: 0, state, chain: 0, score: 0, dist: 0, runId });

test('guest: a delayed pre-restart snapshot can not revert a restarted runner (dead / live / delayed dead)', async (t) => {
  const { host, guest, hs, gs, row } = await room(t);
  const F = host.net._n1.frames, s = F.makeScratch(), seal = (p) => host.net._n1.env.sealApp(row.pair, F.encSnap(s, 0, [{ p: 1, pres: p }]).slice());
  const runId = gs.welcomed.runId;
  const aliveOld = await seal(pres(runId, 1070, 3000, 11));   // last live sample of the old trace
  const dead1 = await seal(pres(runId, 1080, 3010, 4));       // dies
  const dead2 = await seal(pres(runId, 1080, 3010, 4));       // a heartbeat copy of the dead sample
  const live = await seal(pres(runId, 1000, 40, 11));         // restarts: clock reset, same round
  for (const w of [dead1, live, dead2, aliveOld]) await gs._onPacket(hs.keys.pub, w);   // the copy and the old live sample straggle in
  const p = gs.peers.get(1);
  assert.equal(p.x, 40, 'still on the new run (x=' + p.x + ')');
  assert.equal(p.state & 4, 0, 'not reverted to dead');
  // A later sample of the new trace still arrives normally.
  await gs._onPacket(hs.keys.pub, await seal(pres(runId, 1006, 70, 11)));
  assert.equal(gs.peers.get(1).x, 70);
});

test('guest: a sample from before a death can not undo the death by passing as a restart', async (t) => {
  const { host, hs, gs, row } = await room(t);
  const F = host.net._n1.frames, s = F.makeScratch(), seal = (p) => host.net._n1.env.sealApp(row.pair, F.encSnap(s, 0, [{ p: 1, pres: p }]).slice());
  const runId = gs.welcomed.runId;
  const alive = await seal(pres(runId, 1070, 3000, 11));
  const dead = await seal(pres(runId, 1080, 3010, 4));
  await gs._onPacket(hs.keys.pub, dead);
  await gs._onPacket(hs.keys.pub, alive);                     // reordered: sent before the death
  assert.equal(gs.peers.get(1).state & 4, 4, 'still dead');
});

test('host: a delayed pre-restart PRES can not revert a restarted guest', async (t) => {
  const { hub, guest, hs, gs, row } = await room(t);
  hs.beginRound({ delayMs: 0 });
  hub.advance(20000);
  const F = guest.net._n1.frames, s = F.makeScratch(), seal = (p) => guest.net._n1.env.sealApp(gs.pair, F.encPres(s, p).slice());
  const runId = hs.runId;
  const alive = await seal(pres(runId, 1070, 3000, 11));
  const dead = await seal(pres(runId, 1080, 3010, 4));
  const dead2 = await seal(pres(runId, 1080, 3010, 4));
  const live = await seal(pres(runId, 1000, 3050, 11));
  await hs._onPacket(gs.keys.pub, alive); hub.advance(100);
  await hs._onPacket(gs.keys.pub, dead); hub.advance(100);
  await hs._onPacket(gs.keys.pub, live); hub.advance(100);
  await hs._onPacket(gs.keys.pub, dead2);
  assert.equal(row.pres.x, 3050, 'the restart stands (x=' + row.pres.x + ')');
  assert.equal(row.pres.state & 4, 0);
  assert.equal(row.strikes, 0);
});

test('an older PING is still answered but never overwrites a newer link report', async (t) => {
  const { guest, hs, gs, row } = await room(t);
  const F = guest.net._n1.frames, s = F.makeScratch(), seal = (b) => guest.net._n1.env.sealApp(gs.pair, b.slice());
  row.linkId = 65530; row.link = null;                        // pretend the last report was id 65530, just before the wrap
  const older = await seal(F.encPing(s, 65535, 500, 0.2, 100));   // newer than 65530, older than 1 (wrap-aware)
  const newer = await seal(F.encPing(s, 1, 40, 0, 8));
  let pongs = 0;
  const send = hs.relay.send; hs.relay.send = (d, b) => { pongs++; return send(d, b); };
  await hs._onPacket(gs.keys.pub, newer);
  await hs._onPacket(gs.keys.pub, older);
  assert.equal(pongs, 2, 'both probes answered');
  assert.equal(row.link.rtt, 40, 'the newer report stands');
  await hs._onPacket(gs.keys.pub, await seal(F.encPing(s, 2, 90, 0, 8)));
  assert.equal(row.link.rtt, 90, 'a genuinely newer one still updates');
});
