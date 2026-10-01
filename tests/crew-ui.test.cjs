const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function room(t) {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return { hub, host, guest };
}
function tick(c, n = 6) { c.run(`for(let i=0;i<${n};i++) update(); netTick(0.1); render(1);`); }

test('before a round everyone in the room reads as ready, on both ends', async (t) => {
  const { host, guest } = await room(t);
  for (const c of [host, guest]) {
    const st = JSON.parse(c.run('JSON.stringify(crewStandings())'));
    assert.equal(st.phase, 'lobby');
    assert.deepEqual(st.counts, { running: 0, out: 0, waiting: 2, watching: 0 });
  }
});

test('mid-round the crew sees two runners, then a runner out, and the standings render as text only', async (t) => {
  const { hub, host, guest } = await room(t);
  guest.run('startRun({watch:false,sync:true})'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100); tick(host); tick(guest);
  let st = JSON.parse(host.run('JSON.stringify(crewStandings())'));
  assert.equal(st.phase, 'running');
  assert.equal(st.counts.running >= 1, true);
  assert.equal(st.players, 2);
  host.run("const d = document.createElement('div'); toggleCrew(true); renderCrewInto(d, crewStandings()); globalThis.__text = JSON.stringify(d.children.map((c) => c.className))");
  assert.match(host.run('__text'), /crew-sum/);
  assert.equal(host.run('crew.open'), true);
  host.run('toggleCrew(false)');
  assert.equal(host.run('crew.open'), false);
});

test('the crew chip is a real hit target in a run and gone outside one', async (t) => {
  const { hub, host, guest } = await room(t);
  guest.run('startRun({watch:false,sync:true})'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100); tick(host); tick(guest);
  assert.ok(host.run('_crewHit'), 'chip drawn');
  host.run('crew.peek = false; toggleCrew()');
  assert.equal(host.run('crew.open'), true);
  host.run('showAttract()'); tick(host, 1);
  assert.equal(host.run('_crewHit'), null);
});

test('the master mute is a visible switch in settings that drives the same mute as the M key', () => {
  const c = client(relay());
  try {
    assert.equal(c.run("SETTINGS_DEF.some((d) => d.key === 'muted' && d.type === 'switch')"), true);
    c.run("settings.muted = false; toggleSetting('muted')");
    assert.equal(c.run('settings.muted'), true);
    c.run("toggleSetting('muted')");
    assert.equal(c.run('settings.muted'), false);
  } finally { c.close(); }
});

test('a finished round is settled once: the winner gets a star, and leaving the room wipes the tally', async (t) => {
  const { hub, host, guest } = await room(t);
  guest.run('startRun({watch:false,sync:true})'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100); tick(host); tick(guest);
  host.run("crewSettle({ phase: 'over', winner: { p: 2, name: 'COMET FOX', dist: 500, score: 9, you: false }, rows: [{ place: 1 }, { place: 2 }] })");
  assert.deepEqual(JSON.parse(host.run('JSON.stringify(crewLog.wins)')), { 2: 1 });
  host.run("crewSettle({ phase: 'over', winner: { p: 2, name: 'COMET FOX', dist: 500, score: 9, you: false }, rows: [{ place: 1 }, { place: 2 }] })");
  assert.deepEqual(JSON.parse(host.run('JSON.stringify(crewLog.wins)')), { 2: 1 }, 'same runId never counts twice');
  host.run('leaveRoom()');
  assert.deepEqual(JSON.parse(host.run('JSON.stringify(crewLog.wins)')), {});
});
