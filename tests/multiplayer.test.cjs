const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function room(t, guestOpts = {}) {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1, ...guestOpts });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return { hub, host, guest };
}
function tick(c, n = 6) { c.run(`for(let i=0;i<${n};i++) update(); netTick(0.1); render(1);`); }
async function start({ hub, host, guest }, watch = false) {
  guest.run(`startRun({watch:${watch},sync:true})`);
  host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  tick(host); tick(guest);
}

test('joining requires host admission, then supplies identity, seed and complete roster', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, approve: true });
  let resolved = false;
  const joining = guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 }).then(() => { resolved = true; });
  await until(() => host.net._n1.session().pending.size === 1, 'approval request');
  assert.equal(resolved, false); assert.equal(guest.net.active, false);
  await host.net.approve([...host.net._n1.session().pending.keys()][0], true);
  await joining;
  await until(() => guest.net.roster().length === 2);
  assert.equal(guest.net.info().seed, host.net.info().seed);
  assert.equal(guest.net.info().myP, 2);
  assert.equal(host.net.roster()[1].callsign, guest.net.roster()[1].callsign);
  assert.equal(guest.net.info().players, 2);
});

test('declined admission cleans up and allows a real retry', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, approve: true });
  const payload = host.net.info().link.split('#j=')[1];
  const rejected = assert.rejects(guest.net.acceptJoin(payload), /declined/);
  await until(() => host.net._n1.session().pending.size === 1);
  await host.net.approve([...host.net._n1.session().pending.keys()][0], false);
  await rejected;
  assert.equal(guest.net.active, false); assert.equal(guest.net._n1.session(), null);
  host.net.setApprove(false);
  await guest.net.acceptJoin(payload);
  assert.equal(guest.net.active, true);
});

test('waiting and countdown freeze both clients; host starts and resets everyone together', async (t) => {
  const r = await room(t), { host, guest, hub } = r;
  guest.run('startRun({sync:true}); input.right=true;');
  tick(guest, 120);
  assert.equal(guest.run('G.player.x'), 30);
  host.run('startRun()');
  await until(() => guest.net.roundClock()?.active);
  host.run('input.right=true'); guest.run('input.right=true');
  tick(host, 120); tick(guest, 120);
  assert.equal(host.run('G.player.x'), 30); assert.equal(guest.run('G.player.x'), 30);
  hub.advance(3100);
  host.run('input.right=true'); guest.run('input.right=true'); tick(host, 20); tick(guest, 20);
  assert.ok(host.run('G.player.x') > 30); assert.ok(guest.run('G.player.x') > 30);
  const before = host.net.info().runId;
  host.net.newWorld();
  await until(() => guest.run('G.netRunId') !== before);
  assert.equal(host.run('G.player.x'), 30); assert.equal(guest.run('G.player.x'), 30);
  assert.equal(host.net.info().runId, guest.net.info().runId);
});

test('presence travels both directions and expires after clients stop reporting', async (t) => {
  const r = await room(t), { host, guest, hub } = r;
  await start(r);
  await until(() => host.net.presence().some((p) => p.p === 2) && guest.net.presence().some((p) => p.p === 1));
  assert.ok(hub.packetCount > 5);
  hub.advance(3000);
  assert.equal(host.net.presence().some((p) => p.p === 2), false);
  assert.equal(guest.net.presence().some((p) => p.p === 1), false);
});

test('newcomers see every existing player and spectator, including chunked rosters', async (t) => {
  const r = await room(t), extras = [];
  t.after(() => extras.forEach((c) => c.close()));
  for (let i = 0; i < 5; i++) {
    const c = client(r.hub); extras.push(c);
    await c.net.acceptJoin(r.host.net.info().link.split('#j=')[1], { role: i === 4 ? 1 : 0 });
  }
  const last = extras.at(-1);
  await until(() => last.net.roster().length === 7);
  assert.equal(last.net.info().players, 6); assert.equal(last.net.info().spectators, 1);
  assert.equal(await last.net.setRole(0), true);
  await until(() => last.net.info().players === 7);
});

test('spectators follow distant runners, never die locally, and switch away from dead runners', async (t) => {
  const r = await room(t, { role: 1 }), { host, guest, hub } = r;
  await start(r, true);
  host.net.sendPresence(8000, 240, 0, 11, 0, 900, 797);
  await host.net._n1.session()._snapTick();
  await until(() => guest.net.presence().some((p) => p.x === 8000));
  guest.run('netTick(.1)'); tick(guest, 600);
  assert.equal(guest.run('G.mode'), 'play'); assert.equal(guest.run('G.player.dead'), false);
  assert.ok(guest.run('G.camX') > 7000); assert.ok(guest.run('G.genX') > 8000);
  assert.equal(guest.run('stats.runs'), 0);
  host.net.sendPresence(8000, 240, 0, 5, 0, 900, 797);
  await host.net._n1.session()._snapTick();
  await until(() => guest.net.presence().some((p) => p.state === 5));
  guest.run('netTick(.1)'); tick(guest);
  assert.equal(guest.run('watchedGhost()'), null);
  assert.equal(guest.run('G.mode'), 'play');
  hub.advance(10001);
  assert.equal(await guest.net.setRole(0), true);
  guest.run('startRun()'); assert.equal(guest.run('netSpectating()'), false);
});

test('spectate from death card enters watching immediately and rejected role changes stay honest', async (t) => {
  const r = await room(t), { guest } = r;
  await start(r);
  guest.run("G.mode='dead'; G.player.dead=true; G.deathCardShown=true;");
  await guest.run('spectateThisRound()');
  assert.equal(guest.run('G.mode'), 'play'); assert.equal(guest.run('G.deathCardShown'), false);
  assert.equal(guest.run('netSpectating()'), true);
  assert.equal(await guest.net.setRole(0), false); // host rate limit, no optimistic switch
  assert.equal(guest.net.info().role, 1);
});

test('an unrelated full roster crossing a role request is not taken as its ack', async (t) => {
  const r = await room(t), { host, guest, hub } = r;
  await start(r);
  const gs = guest.net._n1.session();
  gs.requestedRole = 1; // as if our ROLE frame is still in flight to the host
  let rosters = 0;
  const off = gs.ev.on((e) => { if (e === 'roster') rosters++; });
  host.net._n1.session().setCallsign(2, 2); // host fans out a full roster first
  await until(() => rosters > 0, 'unrelated full roster');
  off();
  assert.equal(gs.requestedRole, 1, 'stale roster must not clear the pending request');
  assert.equal(guest.net.info().role, 0);
  gs.requestedRole = null;
  hub.advance(1600);
  assert.equal(await guest.net.setRole(1), true);
  assert.equal(guest.net.info().role, 1);
});

test('room terrain is invariant across effects, mercy history, viewports and generation batches', async (t) => {
  const { host, guest } = await room(t);
  const generate = (c, noisy) => JSON.parse(c.run(`JSON.stringify((() => {
    stats.mercy=${noisy}; stats.deadStreak=${noisy ? 9 : 0}; resetRun(123456);
    const all = new Map();
    for (let x=30; x<30000; x+=${noisy ? 711 : 370}) {
      G.player.x=x;
      ${noisy ? 'for(let j=0;j<53;j++) rng(); G.enemies=[];' : ''}
      generateAhead(); for(const p of G.platforms) all.set(p.x,[p.x,p.y,p.w,p.boost,p.boostX]);
    }
    return [...all.values()].filter((p)=>p[0]<29000);
  })())`));
  assert.deepEqual(generate(host, false), generate(guest, true));
});

test('visible teammates on the right half of a wide viewport are rendered', async (t) => {
  const { host } = await room(t);
  const ids = JSON.parse(host.run(`JSON.stringify((() => {
    startRun({sync:true}); view.w=1000; G.camX=0;
    const g=ghostFor(2); Object.assign(g,{x0:900,x1:900,y0:230,y1:230,rx:900,ry:230,t0:netClock()-100,t1:netClock(),lastSeen:netClock(),alpha:1,runId:NET.info().runId,onGround:false});
    const seen=[]; const original=drawGhostActor; drawGhostActor=(g)=>seen.push(g.p);
    try { drawGhosts(1,0); } finally { drawGhostActor=original; }
    return seen;
  })())`));
  assert.deepEqual(ids, [2]);
});

test('new round movement is not rejected as a teleport', async (t) => {
  const { host, guest, hub } = await room(t);
  host.net.startRound({delayMs:0});
  await until(() => guest.net.roundClock()?.active);
  hub.advance(20000); // 10000px is only reachable after ~13s of a round
  guest.net.sendPresence(10000, 200, 0, 11, 0, 1000, 997);
  await until(() => host.net.presence().some((p) => p.p === 2));
  host.net.newWorld(); await until(() => guest.net.info().runId === host.net.info().runId);
  hub.advance(3100); guest.net.sendPresence(40, 250, 0, 11, 0, 0, 1);
  await until(() => host.net.presence().some((p) => p.p === 2 && p.x === 40));
  assert.equal([...host.net._n1.session().roster.values()][0].strikes, 0);
});

test('respawns and first samples are bounded by the round, not skipped', async (t) => {
  const { host, guest, hub } = await room(t);
  const row = () => [...host.net._n1.session().roster.values()][0];
  host.net.startRound({delayMs:0});
  await until(() => guest.net.roundClock()?.active);
  hub.advance(5000);
  guest.net.sendPresence(2000, 250, 0, 11, 0, 100, 197);             // plausible after 5s
  await until(() => host.net.presence().some((p) => p.p === 2 && p.x === 2000));
  guest.net.sendPresence(2010, 250, 0, 4, 0, 100, 198);              // dies in place
  await until(() => host.net.presence().some((p) => p.p === 2 && p.x === 2010));
  assert.equal(row().strikes, 0);
  hub.advance(100);
  guest.net.sendPresence(900000, 250, 0, 11, 0, 100, 198);           // "respawns" across the course
  await until(() => row().strikes === 1, 'respawn teleport strike');
  assert.ok(!host.net.presence().some((p) => p.p === 2 && p.x === 900000));
  guest.net.sendPresence(2500, 250, 0, 11, 0, 100, 198);             // honest respawn beside the crew
  await until(() => host.net.presence().some((p) => p.p === 2 && p.x === 2500));
  assert.equal(row().strikes, 1);
});

test('solo still starts immediately and simulates movement', (t) => {
  const c = client(relay()); t.after(() => c.close());
  c.run('startRun(); input.right=true'); tick(c, 20);
  assert.equal(c.run('G.mode'), 'play'); assert.ok(c.run('G.player.x') > 30);
  assert.equal(c.run('G.course'), null);                        // random, never a fixed Daily/challenge course
});

test('invite Play and Watch lead directly into a live round and late players spawn near the crew', async (t) => {
  const r = await room(t), { host, hub } = r;
  await start(r);
  hub.advance(10000);
  host.net.sendPresence(6000, 240, 0, 11, 0, 600, 597);
  const late = client(hub), watcher = client(hub);
  t.after(() => { late.close(); watcher.close(); });
  const payload = host.net.info().link.split('#j=')[1];
  for (const [c, role] of [[late, 0], [watcher, 1]]) {
    c.run(`G.cosmetics.callsign=[0,0]; joinPayload=${JSON.stringify(payload)};`);
    await c.run(`acceptInvite(${role})`);
    await until(() => c.net.roundClock()?.active);
    assert.equal(c.run('G.mode'), 'play');
    assert.equal(c.run("$('ovRoom').classList.contains('show')"), false);
  }
  await host.net._n1.session()._snapTick();
  await until(() => late.net.presence().some((p) => p.x === 6000));
  late.run('startRun()');
  // Near the crew: the nearest safe ground. World gen 2's opening slabs are wide (a patrol bridge
  // is 440-520px of walkers), so that can be one slab over; 300 room seeds all seat within 600px.
  assert.ok(Math.abs(late.run('G.player.x') - 6000) < 700, 'seated at ' + late.run('G.player.x'));
  tick(late); assert.equal(late.run('G.player.dead'), false);
  assert.equal(watcher.run('netSpectating()'), true);
});

test('old course versions are rejected before opening a socket', async (t) => {
  const { host, guest, hub } = await room(t);
  guest.net.leave();
  const bytes = host.net._n1.bytes;
  const invite = bytes.b64uDec(host.net.info().link.split('#j=')[1]); invite[0] = 1;
  const before = hub.packetCount;
  await assert.rejects(guest.net.acceptJoin(bytes.b64uEnc(invite)), /update/);
  invite[0] = 3;                       // v3.4 clients: same terrain, but aliens still moved per-frame and kills weren't shared
  await assert.rejects(guest.net.acceptJoin(bytes.b64uEnc(invite)), /update/);
  invite[0] = 4;                       // v4 clients: shared aliens, but the original scatter terrain (world gen 1)
  await assert.rejects(guest.net.acceptJoin(bytes.b64uEnc(invite)), /update/);
  assert.equal(hub.packetCount, before); assert.equal(guest.net.active, false);
});

test('delayed encryption preserves counter order and snapshots scratch plaintext', async (t) => {
  const c = client(relay(), { game: false }); t.after(() => c.close());
  const { webcrypto } = require('node:crypto');
  const key = await webcrypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  const api = c.net._n1, roomId = new Uint8Array(8);
  const send = api.env.makePair(key, roomId, 0, api.env.DIR_H2G);
  const recv = api.env.makePair(key, roomId, 0, api.env.DIR_G2H);
  let encryptions = 0;
  c.context.crypto = { getRandomValues: (a) => webcrypto.getRandomValues(a), subtle: {
    encrypt: async (...args) => {
      if (++encryptions === 1) await new Promise((resolve) => setTimeout(resolve, 40));
      return webcrypto.subtle.encrypt(...args);
    },
    decrypt: (...args) => webcrypto.subtle.decrypt(...args),
  } };
  const delivered = [], scratch = new Uint8Array([1]);
  const first = api.env.sealApp(send, scratch).then((wire) => delivered.push(wire));
  scratch[0] = 2;
  const second = api.env.sealApp(send, scratch).then((wire) => delivered.push(wire));
  scratch[0] = 99;
  await Promise.all([first, second]);
  assert.deepEqual(Array.from((await api.env.openApp(recv, delivered[0])).pt), [1]);
  assert.deepEqual(Array.from((await api.env.openApp(recv, delivered[1])).pt), [2]);
});

test('a room round reports runners left, then ROUND OVER standings on every card, and resets on a new round', async (t) => {
  const r = await room(t), { host, guest, hub } = r;
  await start(r);
  const text = (c, id) => c.elements.get(id)?.textContent || '';
  const shown = (c, id) => c.elements.get(id)?.style.display !== 'none';
  // Host pulls ahead; the guest makes a short hop off the start line.
  host.run('input.right=true'); guest.run('input.right=true'); tick(host, 60); tick(guest, 12);
  await host.net._n1.session()._snapTick();
  await until(() => guest.net.presence().some((p) => p.p === 1 && p.dist > 0) && host.net.presence().some((p) => p.p === 2), 'mutual presence');
  tick(host, 1); tick(guest, 1);
  assert.equal(host.run('roundPlace()'), 1); assert.equal(guest.run('roundPlace()'), 2);

  const guestDist = guest.run("die('void'); showDeathCard(); G.dist");
  assert.ok(guestDist > 0 && guestDist < host.run('G.dist'));
  assert.equal(text(guest, 'deadRound'), 'ROUND STILL RUNNING — 1 RUNNER LEFT');
  assert.equal(shown(guest, 'deadStandings'), false);
  assert.equal(shown(guest, 'btnSpectateRound'), true);
  assert.match(text(guest, 'srAnnounce'), /still running/i);

  await until(() => host.net.presence().some((p) => p.p === 2 && (p.state & 4)), 'guest death reaches host');
  host.run('netTick(0.1)');
  hub.advance(3000);   // the guest's ghost fades — its final numbers must survive
  assert.equal(host.net.presence().some((p) => p.p === 2), false);
  host.run('netTick(0.1); die(\'void\'); showDeathCard();');
  const hostCall = host.run('NET.presence().find((p) => p.you).callsign');
  assert.equal(text(host, 'deadRound'), 'ROUND OVER');
  assert.match(text(host, 'deadStandings'), new RegExp('^1st YOU [\\d,]+ m\\n2nd \\S.* ' + guestDist + ' m$'));
  assert.equal(text(host, 'btnAgain'), 'Start New Round');
  assert.equal(shown(host, 'deadRoundNext'), false);

  await host.net._n1.session()._snapTick();
  await until(() => guest.net.presence().some((p) => p.p === 1 && (p.state & 4)), 'host death reaches guest');
  guest.run('netTick(0.1)');
  assert.equal(text(guest, 'deadRound'), 'ROUND OVER');
  const standings = text(guest, 'deadStandings');
  assert.ok(standings.startsWith('1st ' + hostCall + ' '), standings);
  assert.match(standings, new RegExp('\\n2nd YOU ' + guestDist + ' m$'));
  assert.equal(text(guest, 'deadRoundNext'), 'Waiting for host to start the next round');
  assert.match(text(guest, 'srAnnounce'), /^Round over\. 1st /);

  const before = host.net.info().runId;
  host.net.newWorld();
  await until(() => guest.run('G.netRunId') !== before, 'new round');
  host.run('netTick(0.1)'); guest.run('netTick(0.1)');
  for (const c of [host, guest]) {
    assert.equal(c.run('roundResultsRunId'), host.net.info().runId);
    // Only new-round rows remain: nobody dead, everyone still on the start line
    // (the other client's first countdown presence may already have arrived).
    assert.equal(c.run('[...roundResults.values()].every((r) => !r.dead && r.dist === 0)'), true);
    assert.equal(c.run('[...roundResults.values()].some((r) => r.you)'), true);
  }
});

test('a New Round never fans out the host\'s last-run sample under the new runId', async (t) => {
  const { host, guest } = await room(t);
  host.net.startRound({ delayMs: 0 });
  host.net._n1.session().setPresence(5000, 200, 0, 4, 0, 900, 497); // host went down far along the old course
  host.net.newWorld();
  await host.net._n1.session()._snapTick();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(guest.net.presence().some((p) => p.p === 1 && p.runId === host.net.info().runId), false);
});

test('round results never carry into the next room, even with a reused runId', async (t) => {
  const r = await room(t), { host, guest } = r;
  await start(r);
  host.run('netTick(0.1)');
  await until(() => host.run('roundResults.size') >= 1, 'results fed');
  host.run('leaveRoom()');
  assert.equal(host.run('roundResults.size'), 0);
  assert.equal(host.run('roundResultsRunId'), 0);
});
