// Real-browser regression for Star Circuit's road rails and native Web Audio.
// Run with SPACE_MAN_CHROMIUM_PATH=/usr/bin/chromium (or SPACE_MAN_RACE_BROWSER=webkit).
// Only test-local observers are added: race state and input handling stay production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const engine = process.env.SPACE_MAN_RACE_BROWSER === "webkit" ? webkit : chromium;

async function launch(t) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const file = path.resolve(ROOT, "." + decodeURIComponent(pathname) +
        (pathname.endsWith("/") ? "index.html" : ""));
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      res.writeHead(200, { "Content-Type": path.extname(file) === ".js"
        ? "text/javascript" : path.extname(file) === ".html" ? "text/html" : "application/octet-stream" });
      res.end(await fs.readFile(file));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH
    ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, serviceWorkers: "block",
  });
  const page = await context.newPage(), errors = [], sockets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  // Install after production scripts loaded, before the lazy race UI is created.
  // Native AudioContext/nodes are retained, with passive bookkeeping around their
  // real connect/disconnect methods. No synthetic audio clock or fake nodes.
  await page.evaluate(() => {
    const api = SpaceManRaceAudio;
    const NativeContext = window.AudioContext || window.webkitAudioContext;
    window.raceAudioProbe = { controllers: [], contexts: [], nodes: [], nonSuspendedStateChanges: 0 };
    window.SpaceManRaceAudio = {
      ...api,
      create(options) {
        function ObservedContext() {
          const context = new NativeContext();
          raceAudioProbe.contexts.push(context);
          context.addEventListener("statechange", () => {
            if (context.state !== "suspended") raceAudioProbe.nonSuspendedStateChanges++;
          });
          for (const method of ["createGain", "createOscillator", "createBiquadFilter", "createDynamicsCompressor"]) {
            if (!context[method]) continue;
            const original = context[method].bind(context);
            context[method] = (...args) => {
              const node = original(...args);
              const record = { node, type: method, connected: false, ended: false };
              raceAudioProbe.nodes.push(record);
              const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
              node.connect = (...args) => { const result = connect(...args); record.connected = true; return result; };
              node.disconnect = (...args) => { const result = disconnect(...args); record.connected = false; return result; };
              if (method === "createOscillator") node.addEventListener("ended", () => { record.ended = true; });
              return node;
            };
          }
          return context;
        }
        const controller = api.create({ ...options, AudioContext: ObservedContext });
        raceAudioProbe.controllers.push(controller);
        return controller;
      },
    };
    Object.assign(settings, { muted: false, music: true, sfx: true, musicVol: 1, sfxVol: 1 });
    raceAudioProbe.read = () => ({
      ...(raceAudioProbe.controllers[0]?.diagnostics() || {}),
      controllers: raceAudioProbe.controllers.length,
      contexts: raceAudioProbe.contexts.length,
      nativeStates: raceAudioProbe.contexts.map((context) => context.state),
      nativeTime: raceAudioProbe.contexts[0]?.currentTime || 0,
      nonSuspendedStateChanges: raceAudioProbe.nonSuspendedStateChanges,
      createdOscillators: raceAudioProbe.nodes.filter((node) => node.type === "createOscillator").length,
      connectedOscillators: raceAudioProbe.nodes.filter((node) => node.type === "createOscillator" && node.connected).length,
      connectedNodes: raceAudioProbe.nodes.filter((node) => node.connected).length,
      // These are the controller's three permanent mix nodes, in creation order.
      busGains: raceAudioProbe.nodes.filter((node) => node.type === "createGain").slice(0, 3).map(({ node }) => node.gain.value),
    });
  });
  assert.equal(await page.evaluate(() => raceAudioProbe.contexts.length), 0, "no race AudioContext before a gesture");
  await page.locator("#btnRace").click();
  await screen(page, "lobby");
  t.after(() => {
    assert.deepEqual(errors, [], "no uncaught browser errors");
    assert.deepEqual(sockets, [], "local racing opens no network relay");
  });
  return { page, context };
}
async function screen(page, name) {
  await page.locator(`.race-root[data-screen="${name}"]`).waitFor();
}
async function menu(page, name) {
  await page.getByRole("button", { name, exact: true }).filter({ visible: true }).click();
}
async function control(page, name) {
  return page.getByRole("button", { name, exact: true }).filter({ visible: true });
}
async function playing(page) {
  await page.waitForFunction(() => raceUI.snapshot()?.phase === "racing");
}
async function audibleGraph(page, music = true, sfx = true) {
  await page.waitForFunction(({ music, sfx }) => {
    const p = raceAudioProbe.read();
    return p.contextState === "running" && p.ready && !p.paused && p.scheduled &&
      (music ? p.musicVoices > 0 : p.musicVoices === 0) &&
      (sfx ? p.engineVoices === 2 : p.engineVoices === 0);
  }, { music, sfx });
}
async function quietGraph(page, suspended = true) {
  const isQuiet = (p) => !p.scheduled && p.musicVoices === 0 && p.sfxVoices === 0 &&
    p.engineVoices === 0 && p.connectedOscillators === 0;
  await page.waitForFunction((suspended) => {
    const p = raceAudioProbe.read();
    return !p.scheduled && p.musicVoices === 0 && p.sfxVoices === 0 && p.engineVoices === 0 &&
      p.connectedOscillators === 0 && (!suspended || p.contextState === "suspended");
  }, suspended);
  let before = await page.evaluate(() => raceAudioProbe.read());
  if (suspended) {
    // Native audio/control threads may retire their last render quanta after
    // state first says suspended. Observe clock convergence without calling
    // suspend() ourselves or changing the controller's production behavior.
    const deadline = Date.now() + 3000, created = before.createdOscillators;
    const stateChanges = before.nonSuspendedStateChanges;
    let stableSince = Date.now();
    for (;;) {
      await page.waitForTimeout(40);
      const next = await page.evaluate(() => raceAudioProbe.read());
      assert.equal(next.contextState, "suspended", "native context remains suspended while settling");
      assert.equal(next.nonSuspendedStateChanges, stateChanges, "no native resume during clock settling");
      assert.equal(isQuiet(next), true, "no voices or scheduler during native-clock settling");
      assert.equal(next.createdOscillators, created, "no notes created while native-clock settles");
      if (next.nativeTime !== before.nativeTime) stableSince = Date.now();
      before = next;
      assert.ok(Date.now() < deadline, "suspended native audio clock settles within three seconds");
      if (Date.now() - stableSince >= 120) break;
    }
  }
  await page.waitForTimeout(240);
  const after = await page.evaluate(() => raceAudioProbe.read());
  assert.equal(after.createdOscillators, before.createdOscillators, "no background note creation");
  assert.equal(isQuiet(after), true, "no voices or scheduler after quiet interval");
  if (suspended) {
    assert.equal(after.contextState, "suspended");
    assert.equal(after.nonSuspendedStateChanges, before.nonSuspendedStateChanges, "no native resume during quiet interval");
    assert.equal(after.nativeTime, before.nativeTime, "native audio clock is suspended");
  }
}

test("race native audio: gestures, pause, mute/music/volume, stop, reuse and destroy", { timeout: 60000 }, async (t) => {
  const { page } = await launch(t);
  await page.locator(".race-launch").click();
  await playing(page);
  await audibleGraph(page);
  const start = await page.evaluate(() => raceAudioProbe.read());
  assert.equal(start.contexts, 1);
  assert.equal(start.controllers, 1);
  assert.deepEqual(start.nativeStates, ["running"]);
  assert.ok(start.connectedOscillators >= start.engineVoices + start.musicVoices);
  await page.keyboard.down("Space");
  await page.waitForFunction(() => raceUI.snapshot().actors[0].boosting);
  await page.keyboard.up("Space");

  await page.keyboard.press("Escape");
  await screen(page, "pause");
  await quietGraph(page);
  await (await control(page, "Toggle race music")).click();
  assert.equal(await (await control(page, "Toggle race music")).getAttribute("aria-pressed"), "false");
  await quietGraph(page);
  await menu(page, "Resume race");
  await audibleGraph(page, false, true);

  await page.keyboard.press("Escape");
  await (await control(page, "Toggle race sound")).click();
  await menu(page, "Resume race");
  await quietGraph(page, false);
  assert.equal(await page.evaluate(() => settings.muted), true);

  await page.keyboard.press("Escape");
  await (await control(page, "Toggle race sound")).click();
  await (await control(page, "Toggle race music")).click();
  // Use normal keyboard input on the visible range control rather than assigning
  // settings directly. Both music and effect mix channels must reflect it.
  const volume = page.getByRole("slider", { name: "Race audio volume" }).filter({ visible: true });
  await volume.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowRight");
  assert.equal(await volume.inputValue(), "25");
  assert.deepEqual(await page.evaluate(() => [settings.musicVol, settings.sfxVol]), [0.25, 0.25]);
  await menu(page, "Resume race");
  await audibleGraph(page);
  await page.waitForFunction(() => {
    const [, music, sfx] = raceAudioProbe.read().busGains;
    return Math.abs(music - 0.175) < 0.004 && Math.abs(sfx - 0.1625) < 0.004;
  });

  await page.keyboard.press("Escape");
  await menu(page, "Choose a circuit");
  await screen(page, "lobby");
  await quietGraph(page);
  assert.equal(await page.evaluate(() => raceAudioProbe.read().phase), "lobby");
  await menu(page, "← Back to runner");
  await quietGraph(page);
  assert.equal(await page.evaluate(() => raceUI.active), false);
  for (let i = 0; i < 2; i++) {
    await page.locator("#btnRace").click();
    await page.locator(".race-launch").click();
    await playing(page);
    await audibleGraph(page);
    assert.deepEqual(await page.evaluate(() => [raceAudioProbe.read().controllers, raceAudioProbe.read().contexts]), [1, 1],
      "reopening reuses one controller/context");
    await page.keyboard.press("Escape");
    await menu(page, "Choose a circuit");
    await menu(page, "← Back to runner");
    await quietGraph(page);
    assert.equal(await page.evaluate(() => raceAudioProbe.read().connectedNodes), 4,
      "only three mix gains and the limiter remain connected while stopped");
  }
  await page.evaluate(() => raceUI.destroy());
  await page.waitForFunction(() => {
    const p = raceAudioProbe.read();
    return p.disposed && p.contextState === "closed" && p.connectedNodes === 0 && !p.scheduled;
  });
});

test("race native audio: visibility/pagehide handlers stop voices until an explicit resume", { timeout: 35000 }, async (t) => {
  const { page } = await launch(t);
  await page.locator(".race-launch").click();
  await playing(page);
  await audibleGraph(page);
  // Headless engines do not consistently background tabs. Exercise the actual
  // visibility handler with an explicitly emulated Page Visibility state; this
  // does not claim a real OS background/screen-lock test.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await screen(page, "pause");
  await quietGraph(page);
  const tick = await page.evaluate(() => raceUI.snapshot().tick);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => raceUI.snapshot().tick), tick);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await quietGraph(page);
  await menu(page, "Resume race");
  await audibleGraph(page);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await quietGraph(page);
  await screen(page, "pause");
  await menu(page, "Resume race");
  await audibleGraph(page);
});

test("race road rails: genuine wrong steering and boost remain inside all circuits", { timeout: 90000 }, async (t) => {
  const { page } = await launch(t);
  for (const trackId of ["starlight", "ember", "bloom"]) {
    await page.locator(`[data-track="${trackId}"]`).click();
    await page.locator(".race-launch").click();
    await playing(page);
    // Public snapshots are detached; a test reader cannot move the real kart.
    assert.equal(await page.evaluate(() => {
      const detached = raceUI.snapshot();
      const before = detached.actors[0].x;
      detached.actors[0].x += 100000;
      return raceUI.snapshot().actors[0].x === before;
    }), true);
    await page.evaluate(() => {
      const course = SpaceManRace.course(raceUI.snapshot().trackId);
      window.railProbe = { samples: 0, limit: course.width / 2 - SpaceManRace.constants.KART_RADIUS,
        maxDistance: 0, maxPlayerDistance: 0, boosted: false, offroad: false, firstTick: raceUI.snapshot().tick, lastTick: 0 };
      window.railTimer = setInterval(() => {
        const snapshot = raceUI.snapshot();
        if (!snapshot || snapshot.phase !== "racing") return;
        railProbe.samples++;
        railProbe.lastTick = snapshot.tick;
        snapshot.actors.forEach((actor, index) => {
          const distance = SpaceManRace.nearest(course, actor.x, actor.y).distance;
          railProbe.maxDistance = Math.max(railProbe.maxDistance, distance);
          if (index === 0) {
            railProbe.maxPlayerDistance = Math.max(railProbe.maxPlayerDistance, distance);
            railProbe.boosted ||= actor.boosting;
            railProbe.offroad ||= actor.offroad;
          }
        });
      }, 16);
    });
    await page.keyboard.down("Space");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(2800);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(2800);
    await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(3800);
    await page.keyboard.up("Space");
    const result = await page.evaluate(() => { clearInterval(railTimer); return railProbe; });
    assert.ok(result.samples > 100 && result.lastTick - result.firstTick > 300,
      `${trackId}: enough real running frames: ${JSON.stringify(result)}`);
    assert.equal(result.boosted, true, `${trackId}: real boost command reached simulation`);
    assert.equal(result.offroad, true, `${trackId}: adversarial input reached the shoulder`);
    assert.ok(result.maxPlayerDistance >= result.limit - 0.5, `${trackId}: physical rail was exercised`);
    assert.ok(result.maxDistance <= result.limit + 0.05,
      `${trackId}: all kart centers remain inside the rail: ${JSON.stringify(result)}`);
    t.diagnostic(`${trackId}: ${result.samples} samples, max road distance ${result.maxDistance.toFixed(3)} / ${result.limit}`);
    if (process.env.SPACE_MAN_RACE_SCREENSHOTS) {
      await fs.mkdir(process.env.SPACE_MAN_RACE_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SPACE_MAN_RACE_SCREENSHOTS, `handling-${trackId}.png`) });
    }
    await page.keyboard.press("Escape");
    await menu(page, "Choose a circuit");
  }
});

test("race solver: worst-case six-pilot switchback pileup stays within the physics frame budget", { timeout: 20000 }, async (t) => {
  const { page } = await launch(t);
  const timing = await page.evaluate(() => {
    const R=SpaceManRace,c=R.course('ember'),p=R.at(c,17*c.length/20+12),s=R.create({trackId:'ember',count:6});
    const samples=[];
    for(let i=0;i<150;i++) {
      s.phase='racing';
      s.actors.forEach(a=>Object.assign(a,{x:p.x,y:p.y,heading:Math.atan2(p.ty,p.tx),recoveryTicks:1,passed:17,nextGate:18,progress:17,finishTick:null,vx:0,vy:0,speed:0}));
      const start=performance.now(); R.step(s);
      if(i>=30)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);
    return {median:samples[60],p95:samples[114],max:samples[119]};
  });
  t.diagnostic(`Worst-case six-kart contact physics, milliseconds: ${JSON.stringify(timing)}`);
  assert.ok(timing.median<12 && timing.p95<25, 'bounded solver must leave a practical rendering budget');
});
