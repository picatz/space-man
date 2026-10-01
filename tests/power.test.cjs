// Battery / thermal behaviour: pacing never changes the game, saving really saves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

// Play a fixed input script through the REAL frame loop at a given display cadence.
// Input is sampled per simulation step (the QA bot reads only sim state), which is what
// makes the question well-posed: does the render cadence change what the sim does?
function playAt(t, { hz, saver = false, dpr = 2, frames = 20000 }) {
  const c = client(relay(), { dpr, width: 390, height: 844 });
  t.after(() => c.close());
  if (saver) c.run('toggleSetting("batterySaver")');
  return JSON.parse(c.run(`(() => {
    stats.mercy = false; stats.deadStreak = 0; startRun(); resetRun(42); G.mode = 'play';
    // Snapshot the sim at the step it ends (death, or LIMIT steps): what happens after a death
    // is presentation paced on wall time (the ragdoll beat before the card), not gameplay.
    const LIMIT = 1500, step = update;
    let snap = null;
    const take = () => ({ f: G.frameCount, x: G.player.x, y: G.player.y, vx: G.player.vx, vy: G.player.vy, dead: G.player.dead,
      score: G.score, dist: G.dist, chain: G.chain, kills: stats.kills, flare: G.flare.x,
      enemies: G.enemies.map((e) => [Math.round(e.x * 1000), Math.round(e.y * 1000), !!e.dead]), plats: G.platforms.length });
    update = function () {
      if (snap) return;
      botInput();                                           // the QA bot: input as a pure function of sim state
      const r = step();
      if (G.player.dead || G.frameCount >= LIMIT) snap = take();
      return r;
    };
    let now = 1000, rendered = 0; const r0 = render; render = function () { rendered++; return r0.apply(this, arguments); };
    frame(now);
    for (let i = 0; i < ${frames} && !snap; i++) { now += 1000 / ${hz}; frame(now); }
    update = step; render = r0;
    return JSON.stringify({ sim: snap, rendered, dpr: view.dpr, pcap: pCapLive });
  })()`));
}

test('the simulation is identical at 30, 60 and 144 fps and under battery saver (same inputs, same result)', (t) => {
  const a = playAt(t, { hz: 60 });
  assert.ok(a.sim.x > 3000 && a.sim.f > 600, 'the scripted runner went somewhere ' + JSON.stringify(a));
  const b = playAt(t, { hz: 30 });
  const c = playAt(t, { hz: 144 });
  const d = playAt(t, { hz: 60, saver: true });            // real 60 Hz display, the saver drops every other frame
  assert.deepEqual(b.sim, a.sim, '30 fps');
  assert.deepEqual(c.sim, a.sim, '144 fps');
  assert.deepEqual(d.sim, a.sim, 'battery saver');
  t.diagnostic(`frames rendered for ${a.sim.f} sim steps: 60Hz ${a.rendered}, saver ${d.rendered}, 144Hz ${c.rendered}`);
  assert.ok(d.rendered < a.rendered * 0.55, 'the saver really renders about half as often (' + d.rendered + ' vs ' + a.rendered + ')');
});

test('battery saver: 1× resolution and half the particle pool, restored when switched off; setting persists and sanitizes', (t) => {
  const storage = new Map();
  const c = client(relay(), { dpr: 3, storage });
  t.after(() => c.close());
  assert.equal(c.run('view.dpr'), 3, 'a 3× phone starts at its full density');
  c.run('toggleSetting("batterySaver")');
  assert.equal(c.run('view.dpr'), 1);
  assert.equal(c.run('pCapLive'), 80);
  assert.equal(c.run('frameGapMs()').toFixed(1), (1000 / 30).toFixed(1));
  assert.ok(JSON.parse(storage.get(c.run('LS.settings'))).batterySaver === true, 'persisted');
  c.run('toggleSetting("batterySaver")');
  assert.equal(c.run('view.dpr'), 3);
  assert.equal(c.run('pCapLive'), 160);
  c.run("G.mode = 'play'"); assert.equal(c.run('frameGapMs()'), 0, 'a live run on a desktop is paced by the display alone');
  // A saved true comes back on; garbage sanitizes to off.
  const again = client(relay(), { dpr: 3, storage: new Map([[c.run('LS.settings'), JSON.stringify({ batterySaver: true })]]) });
  t.after(() => again.close());
  assert.equal(again.run('settings.batterySaver'), true); assert.equal(again.run('view.dpr'), 1); assert.equal(again.run('pCapLive'), 80);
  const junk = client(relay(), { storage: new Map([[c.run('LS.settings'), JSON.stringify({ batterySaver: 'yes' })]]) });
  t.after(() => junk.close());
  assert.equal(junk.run('settings.batterySaver'), false);
  assert.equal(c.run('SETTINGS_DEF.find((d) => d.key === "batterySaver").noShot'), true, 'kept out of the settings goldens');
});

test('a low, unplugged battery turns the saver on by itself; charging turns it off', async (t) => {
  const listeners = {};
  const battery = { level: 0.5, charging: false, addEventListener: (e, f) => { listeners[e] = f; } };
  const c = client(relay(), { dpr: 2, game: false });
  t.after(() => c.close());
  c.context.navigator.getBattery = () => Promise.resolve(battery);
  const fs = require('node:fs'), path = require('node:path');
  c.run(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  await new Promise((r) => setImmediate(r));
  assert.equal(c.run('powerSaving()'), false);
  battery.level = 0.15; listeners.levelchange();
  assert.equal(c.run('powerSaving()'), false, '15% is not an emergency: the game stays smooth and sharp');
  battery.level = 0.09; listeners.levelchange();
  assert.equal(c.run('powerSaving()'), true); assert.equal(c.run('view.dpr'), 1);
  battery.charging = true; listeners.chargingchange();
  assert.equal(c.run('powerSaving()'), false); assert.equal(c.run('view.dpr'), 2);
  battery.charging = false; listeners.chargingchange();
  assert.equal(c.run('powerSaving()'), true);
  c.run('settings.autoSaver = false');
  assert.equal(c.run('powerSaving()'), false, 'the player can opt out of automatic saving');
});

test('behind a pause or the run-over card the loop idles at 15 fps, and a hidden tab stops it entirely', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  let rafs = 0, cancels = 0;
  c.context.requestAnimationFrame = () => ++rafs;
  c.context.cancelAnimationFrame = () => { cancels++; };
  c.run('startRun(); G.mode = "pause"; var __n = 0; const __r = render; render = function () { __n++; return __r.apply(this, arguments); }; var __t = 1000; frame(__t);');
  c.run('for (let i = 0; i < 60; i++) { __t += 1000 / 60; frame(__t); }');
  const n = c.run('__n');
  assert.ok(n >= 14 && n <= 17, 'pause renders ~15 times a second (' + n + ')');
  c.run('G.mode = "play"; __n = 0; for (let i = 0; i < 60; i++) { __t += 1000 / 60; frame(__t); }');
  assert.ok(c.run('__n') >= 59, 'a live run is never throttled');
  // Hidden: the rAF chain is cancelled; visible again restarts it.
  c.context.document.hidden = true;
  c.run('startLoop(); power.looping = !!rafId; stopLoop();');
  assert.equal(c.run('rafId'), 0);
  assert.ok(cancels >= 1);
  c.context.document.hidden = false;
  c.run('if (power.looping) startLoop()');
  assert.notEqual(c.run('rafId'), 0);
});

test('idle audio suspends after 8 s with music off outside a run, and any sound wakes it', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  let suspends = 0, resumes = 0;
  c.run('Audio.suspend = () => { __s(); }; Audio.resume = () => { __r(); };');
  c.context.__s = () => suspends++; c.context.__r = () => resumes++;
  c.run('settings.music = false; showAttract(); power.audioIdleAt = performance.now(); tickAudioPower();');
  assert.equal(suspends, 0, 'not yet');
  c.run('power.audioIdleAt = performance.now() - 9000; tickAudioPower();');
  assert.equal(suspends, 1);
  c.run('Audio.sfx.ui(1)');
  assert.ok(resumes >= 1, 'a sound resumes the context');
  c.run('settings.music = true; power.audioIdleAt = 0; tickAudioPower();');
  assert.equal(suspends, 1, 'music on: never suspended');
});

test('the title screen idles down: 30 fps, then 15 after a minute, then a crawl after five, and any input wakes it', () => {
  const { client, relay } = require('./harness.cjs');
  const c = client(relay());
  try {
    const gap = () => Math.round(1000 / c.run('frameGapMs()'));
    c.run("G.mode = 'attract'; settings.batterySaver = false; batteryLow = false; settings.music = false; power.lastInputAt = performance.now()");
    c.context.document.hasFocus = () => true;
    assert.equal(gap(), 30, 'a calm title screen needs no more than 30 fps');
    c.context.performance.now = ((n) => () => n() + 61000)(c.context.performance.now);
    assert.equal(gap(), 15, 'a minute of nobody there');
    c.context.performance.now = ((n) => () => n() + 300000)(c.context.performance.now);
    assert.equal(gap(), 5, 'five minutes: a crawl (silent)');
    c.run('settings.music = true; settings.muted = false');
    assert.equal(gap(), 10, 'with music playing the conductor still needs a frame every 100 ms');
    c.run('noteInput()');
    assert.equal(gap(), 30, 'any input wakes it at once');
    c.context.document.hasFocus = () => false;
    assert.equal(gap(), 15, 'visible but behind another window');
  } finally { c.close(); }
});

test('a live run draws every refresh by default (120 Hz where the screen has it), and 60 only if smooth motion is switched off', () => {
  const { client, relay } = require('./harness.cjs');
  const c = client(relay());
  try {
    c.run("G.mode = 'play'; settings.batterySaver = false; batteryLow = false; batteryCritical = false");
    assert.equal(c.run('settings.smooth'), true, 'on by default');
    assert.equal(c.run('frameGapMs()'), 0);
    c.run('settings.smooth = false');
    assert.equal(Math.round(1000 / c.run('frameGapMs()')), 60);
    c.run('settings.smooth = true; settings.batterySaver = true');
    assert.equal(Math.round(1000 / c.run('frameGapMs()')), 30, 'the battery saver still wins');
  } finally { c.close(); }
});
