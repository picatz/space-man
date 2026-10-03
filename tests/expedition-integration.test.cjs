const test = require('node:test');
const assert = require('node:assert/strict');
const {client, relay} = require('./harness.cjs');
function setup(t) {
  const c = client(relay()); t.after(() => c.close());
  c.run(`window.callbacks = {}; window.SpaceManArenaUI = {create: stub('arena')}; window.SpaceManRaceUI = {create: stub('race')};
    function stub(id) { return options => ({ active: false, openSession(config, done) { this.active = true; callbacks[id] = done; return true; }, close() { this.active = false; options.onClose(); } }); }
  `);
  return c;
}
test('one solo itinerary connects runner, CPU arena and CPU race with held input cleared', t => {
  const c = setup(t);
  c.run('openExpedition()'); assert.equal(c.run('expedition.snapshot().phase'), 'briefing');
  assert.equal(c.run('swSafeMoment()'), false);
  c.run('launchExpeditionLeg(); input.right = true; G.dist = 400; G.score = 450; G.finalScore = 450; finalizeDeath(true); finishExpeditionRunner(true)');
  assert.equal(c.run('stats.runs'), 1); assert.equal(c.run('stats.deadStreak'), 0);
  assert.equal(c.run('input.right'), false); assert.equal(c.run('G.mode'), 'attract');
  c.run('launchExpeditionLeg(); launchExpeditionLeg()'); assert.equal(c.run('arenaUI.active'), true);
  c.run('callbacks.arena({won:true, kos:3,stocks:2})'); assert.equal(c.run('arenaUI.active'), false);
  assert.equal(c.run('expedition.snapshot().records.length'), 2);
  c.run('callbacks.arena({won:false}); launchExpeditionLeg()'); assert.equal(c.run('raceUI.active'), true);
  c.run('callbacks.race({position:2,finished:true,time:77.4})');
  assert.equal(c.run('raceUI.active'), false); assert.equal(c.run('expedition.snapshot().phase'), 'complete');
  assert.equal(c.run('stats.runs'), 1); assert.equal(c.net.active, false);
  c.run('exitExpedition(); startRun(); input.right = true; update()');
  assert.equal(c.run('expedition'), null); assert.ok(c.run('G.player.vx > 0'));
});
test('runner death advances the trip and banks its score exactly once', t => {
  const c = setup(t);
  c.run("openExpedition(); launchExpeditionLeg(); G.score = 77; die('void'); showDeathCard()");
  assert.equal(c.run('expedition.snapshot().records[0].reached'), false);
  assert.equal(c.run('expedition.snapshot().records[0].score'), 77);
  assert.equal(c.run('stats.runs'), 1); assert.equal(c.run('G.mode'), 'attract');
  c.run('finishExpeditionRunner(false); exitExpedition()'); assert.equal(c.run('stats.runs'), 1);
});
test('a runner time limit reaches a real intermission instead of an endless leg', t => {
  const c = setup(t);
  c.run('openExpedition(); launchExpeditionLeg(); G.frameCount = 3600; update()');
  assert.equal(c.run('expedition.snapshot().phase'), 'debrief');
  assert.equal(c.run('expedition.snapshot().records.length'), 1);
});
test('exiting a leg invalidates its delayed result and restores title controls', t => {
  const c = setup(t);
  c.run('openExpedition(); launchExpeditionLeg(); G.finalScore = 0; finishExpeditionRunner(false); launchExpeditionLeg(); window.oldResult = callbacks.arena; arenaUI.close()');
  assert.equal(c.run('expedition'), null); assert.equal(c.run('G.mode'), 'attract');
  c.run('openExpedition(); oldResult({won:true})');
  assert.equal(c.run('expedition.snapshot().records.length'), 0);
  c.run('exitExpedition()'); assert.equal(c.elements.get('btnQuit').textContent, 'Quit to Title');
});
test('expedition never leaves or repurposes an existing room', t => {
  const c = setup(t); c.net.mockActive = true; c.run('openExpedition()');
  assert.equal(c.run('expedition'), null); assert.equal(c.net.mockActive, true);
  assert.match(c.elements.get('srAnnounce').textContent, /room is still connected/);
  c.net.mockActive = false;
});
