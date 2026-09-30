// Review round 2 on PR #17: host-outage resync, audio wake on music, burst history cursors.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');
const nb = require('./netbench.cjs');

test('after a host outage every guest gets the round, kills and positions it missed — no re-HELLO needed', async (t) => {
  const hub = nb.shape(relay()), host = client(hub, { game: false });
  const guests = [client(hub, { game: false }), client(hub, { game: false })];
  t.after(() => { host.close(); guests.forEach((g) => g.close()); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  for (const g of guests) await g.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guests.every((g) => g.net.roster().length === 3), 'complete roster');
  host.net.startRound({ delayMs: 0 });
  await until(() => guests.every((g) => g.net.roundClock()?.active), 'first round');
  const hs = host.net._n1.session();
  const kills = guests.map(() => []);
  guests.forEach((g, i) => g.net.onEvent((e, d) => { if (e === 'kill') kills[i].push(d.id); }));
  const helloAt = [...hs.roster.values()].map((r) => r.lastHello || 0);
  // The host's link drops (the relay socket fails); while it is down the host kills an alien
  // and starts a New Round — neither can be sent.
  nb.setLink(host, { down: true });
  hs.relay.kick('outage');
  assert.notEqual(hs.relay.state, 'established');
  host.net.newWorld();
  const runId = host.net.info().runId;
  hs.sendKill(424242);
  nb.setLink(host, 'lan');                                 // back before the reconnect timer fires
  await until(() => hs.relay.state === 'established', 'host reconnected', 8000);
  await until(() => guests.every((g) => g.net.info().runId === runId), () => 'guests on run ' + guests.map((g) => g.net.info().runId) + ', host on ' + runId, 4000);
  await until(() => kills.every((k) => k.includes(424242)), 'every guest learns the kill', 4000);
  assert.ok(guests.every((g) => g.net.roundClock().active), 'the new round clock is anchored on every guest');
  assert.deepEqual([...hs.roster.values()].map((r) => r.lastHello || 0), helloAt, 'no guest had to re-HELLO');
  assert.ok([...hs.roster.values()].every((r) => r.strikes === 0));
});

test('music switched on after an idle suspend wakes the audio at once (switch, unmute, and the tick)', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  let resumes = 0;
  c.context.__r = () => resumes++;
  c.run('Audio.suspend = () => {}; Audio.resume = () => __r(); settings.music = false; settings.muted = false; showAttract();');
  c.run('power.audioIdleAt = performance.now() - 9000; tickAudioPower();');   // idle → suspended
  resumes = 0;
  c.run('toggleSetting("music")');
  assert.ok(resumes >= 1, 'the Music switch resumes the context');
  resumes = 0;
  c.run('settings.muted = true; toggleMute()');             // unmute
  assert.ok(resumes >= 1, 'unmute resumes the context');
  resumes = 0;
  c.run('tickAudioPower()');
  assert.ok(resumes >= 1, 'the conductor tick with music on keeps the context awake');
});

test('a burst of samples sharing one arrival time all reach the jitter buffer', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'roster');
  guest.run('startRun({sync:true})'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'round');
  hub.advance(3100);
  // A head-of-line stall releases five snapshots at once: with a coarse clock they all
  // arrive stamped with the same performance.now().
  const gs = guest.net._n1.session(), F = guest.net._n1.frames, s = F.makeScratch(), runId = guest.net.info().runId;
  guest.context.performance.now = () => 123456.5;
  for (let i = 0; i < 5; i++) {
    const snap = F.encSnap(s, i, [{ p: 1, pres: { t: 600 + i * 6, x: 1000 + i * 30, y: 250, vx: 50, vy: 0, state: 11, chain: 0, score: 0, dist: 0, runId } }]).slice();
    const wire = await host.net._n1.env.sealApp([...host.net._n1.session().roster.values()][0].pair, snap);
    await gs._onPacket(host.net._n1.session().keys.pub, wire);
  }
  guest.run('netTick(0.016)');
  const n = guest.run('ghostByP.get(1).track.s.length');
  assert.equal(n, 5, 'all five samples buffered (got ' + n + ')');
});
