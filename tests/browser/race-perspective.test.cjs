// Real browser tests for Star Circuit's production UI and fixed-tick simulation.
// The actual title launcher parks the runner and restores it on exit.
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  http = require("node:http"),
  path = require("node:path");
const { chromium, webkit } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_TRACK = process.env.SPACE_MAN_RACE_COURSE || "starlight";
assert.ok(["starlight", "prism"].includes(EVIDENCE_TRACK));
const engine =
  process.env.SPACE_MAN_RACE_BROWSER === "webkit" ? webkit : chromium;
async function launch(t, device = {}, init) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const file = path.resolve(
        ROOT,
        "." +
          decodeURIComponent(pathname) +
          (pathname.endsWith("/") ? "index.html" : ""),
      );
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      const data = await fs.readFile(file);
      res
        .writeHead(200, {
          "Content-Type":
            path.extname(file) === ".js"
              ? "text/javascript"
              : path.extname(file) === ".html"
                ? "text/html"
                : path.extname(file) === ".css"
                  ? "text/css"
                  : "application/octet-stream",
        })
        .end(data);
    } catch (_) {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  browser = await engine.launch(
    engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH
      ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH }
      : {},
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    ...device,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(),
    errors = [],
    sockets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (w) => sockets.push(w.url()));
  await page.goto(
    process.env.SPACE_MAN_BASE_URL ||
      `http://127.0.0.1:${server.address().port}/`,
  );
  await page.evaluate(() => {
    window.prefs = settings;
    settings.muted = true;
  });
  await page.locator("#btnRace").click();
  await screen(page, "lobby");
  t.after(() => {
    assert.deepEqual(errors, [], "no uncaught browser errors");
    assert.deepEqual(sockets, [], "local race opens no relay");
  });
  return { page, context };
}
async function screen(page, s) {
  await page.locator(`.race-root[data-screen="${s}"]`).waitFor();
}
async function playing(page) {
  await page.waitForFunction(() => raceUI.snapshot()?.phase === "racing");
}
async function capture(page, name) {
  if (!process.env.SPACE_MAN_RACE_SCREENSHOTS) return;
  await fs.mkdir(process.env.SPACE_MAN_RACE_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.SPACE_MAN_RACE_SCREENSHOTS, name + ".png"),
  });
}
async function menu(page, name) {
  await page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .click();
}

// Decode browser-generated 8-bit RGB/RGBA PNGs without a runtime dependency.
// This checks actual raster output, not merely a successfully created context.
function rasterStats(png) {
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0;
  const chunks = [];
  while (offset < png.length) {
    const n = png.readUInt32BE(offset),
      kind = png.toString("ascii", offset + 4, offset + 8),
      data = png.subarray(offset + 8, offset + 8 + n);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels);
    }
    if (kind === "IDAT") chunks.push(data);
    offset += n + 12;
  }
  const raw = require("node:zlib").inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    decoded = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      A = Math.abs(p - a),
      B = Math.abs(p - b),
      C = Math.abs(p - c);
    return A <= B && A <= C ? a : B <= C ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x,
        a = x >= channels ? decoded[at - channels] : 0,
        b = y ? decoded[at - stride] : 0,
        c = y && x >= channels ? decoded[at - stride - channels] : 0;
      decoded[at] =
        (raw[y * (stride + 1) + x + 1] +
          ([0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter] || 0)) &
        255;
    }
  }
  const colors = new Set();
  let bright = 0,
    samples = 0;
  for (let y = Math.floor(height * 0.5); y < height * 0.9; y += 3)
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x += 3) {
      const at = (y * width + x) * channels,
        r = decoded[at],
        g = decoded[at + 1],
        b = decoded[at + 2];
      colors.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
      if (r + g + b > 110) bright++;
      samples++;
    }
  return {
    colors: colors.size,
    brightFraction: bright / samples,
    width,
    height,
  };
}

test(
  "perspective: rendered road pixels, three cameras, reset, context recovery and runner return",
  { timeout: 60000 },
  async (t) => {
    const { page } = await launch(t);
    await page.locator(".race-launch").click();
    await page.waitForFunction(
      () => document.querySelector(".race-root").dataset.renderer === "webgl",
    );
    await capture(page, "perspective-chase-desktop");
    assert.equal(
      await page.locator(".race-root").getAttribute("data-camera"),
      "chase",
    );
    const world = page.locator(".race-world");
    const chase = await world.screenshot();
    const pixels = rasterStats(chase);
    assert.ok(
      pixels.colors > 14,
      "road/karts produce varied lit foreground pixels: " +
        JSON.stringify(pixels),
    );
    assert.ok(
      pixels.brightFraction > 0.12,
      "road occupies visible foreground: " + JSON.stringify(pixels),
    );
    assert.ok(
      chase.length > 14000,
      "real track/kart geometry must produce a nonblank raster",
    );
    await page
      .getByRole("button", { name: "Camera view", exact: true })
      .click();
    await page.locator('.race-view-menu [data-camera="cockpit"]').click();
    await page.waitForTimeout(150);
    const cockpit = await world.screenshot();
    assert.notDeepEqual(
      cockpit,
      chase,
      "cockpit has genuinely different perspective pixels",
    );
    await capture(page, "perspective-cockpit-desktop");
    await page.keyboard.press("c");
    assert.equal(
      await page.locator(".race-root").getAttribute("data-camera"),
      "topdown",
    );
    await page.locator(".race-canvas").waitFor({ state: "visible" });
    await capture(page, "perspective-topdown-desktop");
    await page.keyboard.press("c");
    await page.waitForFunction(
      () => document.querySelector(".race-root").dataset.renderer === "webgl",
    );
    const supported = await page.evaluate(() => {
      const g = document.querySelector(".race-world").getContext("webgl");
      window.testLoss = g.getExtension("WEBGL_lose_context");
      if (testLoss) {
        testLoss.loseContext();
        return true;
      }
      return false;
    });
    if (supported) {
      await page.waitForFunction(
        () =>
          document.querySelector(".race-root").dataset.renderer ===
          "2d-fallback",
      );
      assert.equal(await page.locator(".race-canvas").isVisible(), true);
      await page.waitForTimeout(200);
      await page.evaluate(() => testLoss.restoreContext());
      await page.waitForFunction(
        () => document.querySelector(".race-root").dataset.renderer === "webgl",
      );
    }
    await page.getByRole("button", { name: "Pause race", exact: true }).click();
    await page.locator('.race-compact:visible [data-camera="cockpit"]').click();
    assert.equal(
      await page.locator(".race-root").getAttribute("data-camera"),
      "cockpit",
    );
    await menu(page, "Resume race");
    await page.getByRole("button", { name: "Pause race", exact: true }).click();
    await menu(page, "All games");
    assert.equal(await page.evaluate(() => raceUI.active), false);
    await page.locator("#btnRace").click();
    await page.locator(".race-launch").click();
    assert.equal(
      await page.locator(".race-root").getAttribute("data-camera"),
      "cockpit",
    );
  },
);
test(
  "perspective mobile: portrait/landscape camera menu and touch-safe composition",
  { timeout: 40000 },
  async (t) => {
    const { page } = await launch(t, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await page.locator(".race-launch").click();
    await page.waitForFunction(
      () => document.querySelector(".race-root").dataset.renderer === "webgl",
    );
    await capture(page, "perspective-chase-portrait");
    for (const size of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(120);
      const boxes = await page
        .locator(".race-view-toggle,.race-touch-button,.race-pause")
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
        );
      for (const b of boxes)
        assert.ok(
          b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.w <= size.width + 1 &&
            b.y + b.h <= size.height + 1,
        );
      await page
        .getByRole("button", { name: "Camera view", exact: true })
        .click();
      await page.locator('.race-view-menu [data-camera="cockpit"]').click();
      await capture(page, "perspective-cockpit-" + size.width);
      await page
        .getByRole("button", { name: "Camera view", exact: true })
        .click();
      await page.locator('.race-view-menu [data-camera="chase"]').click();
    }
  },
);
test(
  "perspective failure: unavailable WebGL automatically keeps playable top-down",
  { timeout: 30000 },
  async (t) => {
    const { page } = await launch(t, {}, () => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === "webgl" || type === "experimental-webgl"
          ? null
          : get.call(this, type, ...args);
      };
    });
    await page.locator(".race-launch").click();
    await playing(page);
    assert.equal(
      await page.locator(".race-root").getAttribute("data-renderer"),
      "2d-fallback",
    );
    assert.equal(await page.locator(".race-canvas").isVisible(), true);
    await capture(page, "perspective-fallback");
    const tick = await page.evaluate(() => raceUI.snapshot().tick);
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate((t) => raceUI.snapshot().tick > t, tick));
  },
);

test(
  "perspective gameplay: title to cockpit, full race, chase finish and playable runner",
  { timeout: 120000 },
  async (t) => {
    const { page } = await launch(t, {}, () => {
      window.testPad = {
        connected: true,
        mapping: "standard",
        index: 0,
        axes: [0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [testPad],
        configurable: true,
      });
    });
    await page.locator(`[data-track="${EVIDENCE_TRACK}"]`).click();
    await page.locator(".race-launch").click();
    await page
      .getByRole("button", { name: "Camera view", exact: true })
      .click();
    await page.locator('.race-view-menu [data-camera="cockpit"]').click();
    await playing(page);
    await page.evaluate(() => {
      window.driver = setInterval(() => {
        const s = raceUI.snapshot();
        if (!s || s.phase !== "racing") return;
        const c = SpaceManRace.cpuInput(s, s.actors[0]);
        testPad.axes[0] = c.steer;
        testPad.buttons[0].pressed = c.boost;
        testPad.buttons[1].pressed = c.brake;
        testPad.buttons[5].pressed = c.item;
      }, 16);
    });
    await page.waitForFunction(
      () => raceUI.snapshot().actors[0].lap >= 2,
      null,
      { timeout: 50000 },
    );
    await capture(page, "perspective-cockpit-lap-two");
    await page
      .getByRole("button", { name: "Camera view", exact: true })
      .click();
    await page.locator('.race-view-menu [data-camera="chase"]').click();
    await screen(page, "results");
    await page.evaluate(() => {
      clearInterval(driver);
      testPad.axes[0] = 0;
      testPad.buttons.forEach((b) => (b.pressed = false));
    });
    const result = await page.evaluate(() => raceUI.snapshot());
    assert.equal(result.actors[0].passed, 60);
    assert.equal(result.actors[0].recoveries, 0);
    assert.ok(result.actors[0].finishTick > 600);
    await capture(page, "perspective-complete-race");
    await menu(page, "All games");
    assert.equal(await page.evaluate(() => raceUI.active), false);
    await page.locator("#btnPlay").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.down("d");
    await page.waitForFunction(() => G.mode === "play" && G.player.vx > 0);
    await page.keyboard.up("d");
  },
);

test(
  "perspective corners: drive Ember and Bloom hairpins, interrupt steering, rescue and keep camera coherent",
  { timeout: 120000 },
  async (t) => {
    const { page } = await launch(t, {}, () => {
      window.testPad = {
        connected: true,
        mapping: "standard",
        index: 0,
        axes: [0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [testPad],
        configurable: true,
      });
    });
    for (const track of ["ember", "bloom"]) {
      await page.locator(`[data-track="${track}"]`).click();
      await page.locator(".race-launch").click();
      await playing(page);
      await page.evaluate(() => {
        window.driver = setInterval(() => {
          const s = raceUI.snapshot();
          if (!s || s.phase !== "racing") return;
          const c = SpaceManRace.cpuInput(s, s.actors[0]);
          testPad.axes[0] = c.steer;
          testPad.buttons[0].pressed = c.boost;
          testPad.buttons[1].pressed = c.brake;
        testPad.buttons[5].pressed = c.item;
        }, 16);
      });
      for (const gate of [5, 10, 15, 19]) {
        await page.waitForFunction(
          (g) => raceUI.snapshot().actors[0].passed >= g,
          gate,
          { timeout: 30000 },
        );
        await capture(page, `perspective-${track}-bend-${gate}`);
      }
      await page.evaluate(() => {
        clearInterval(driver);
        testPad.axes[0] = 0;
        testPad.buttons.forEach((b) => (b.pressed = false));
      });
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(1200);
      await page.keyboard.up("ArrowRight");
      await capture(page, `perspective-${track}-edge-interrupt`);
      const recoveries = await page.evaluate(
        () => raceUI.snapshot().actors[0].recoveries,
      );
      // The production loop samples held keys. A zero-duration Playwright
      // press can land entirely between software-WebKit frames; hold the real
      // key until a physics tick consumes it, then verify release normally.
      await page.keyboard.down("r");
      try {
        await page.waitForFunction(
          (n) => raceUI.snapshot().actors[0].recoveries > n,
          recoveries,
        );
      } finally {
        await page.keyboard.up("r");
      }
      await capture(page, `perspective-${track}-recovery`);
      assert.equal(
        await page.locator(".race-root").getAttribute("data-renderer"),
        "webgl",
      );
      await page
        .getByRole("button", { name: "Pause race", exact: true })
        .click();
      await menu(page, "Choose a circuit");
    }
  },
);

test(
  "perspective short landscape: camera reset remains clickable above touch controls and status rail",
  { timeout: 30000 },
  async (t) => {
    const { page } = await launch(t, {
      viewport: { width: 568, height: 320 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--game-ui-top", "38px");
      document.documentElement.style.setProperty("--game-ui-bottom", "24px");
    });
    await page.locator(".race-launch").click();
    await page.getByRole("button", { name: "Camera view", exact: true }).tap();
    const reset = page
      .locator(".race-view-menu")
      .getByRole("button", { name: "Reset camera", exact: true });
    const bounds = await reset.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
    const hit = await reset.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest("button") === n
      );
    });
    assert.equal(
      hit,
      true,
      "Reset camera must not be covered by the touch overlay",
    );
    await capture(page, "perspective-short-landscape-menu");
    await reset.tap();
    assert.equal(
      await page
        .getByRole("button", { name: "Camera view", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(await page.locator(".race-pressed").count(), 0);
  },
);

// Test-only instrumentation. The shipped simulation, commands and renderer are
// called unchanged; no poses, clocks, events or authority state are injected.
function installLapTrace() {
  window.testPad = {
    connected: true, mapping: "standard", index: 0, axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [testPad], configurable: true,
  });
  const trace = window.raceLapTrace = {
    recording: false, done: false, start: null, end: null,
    frames: [], steps: [], events: [], driver: [],
    sampler: { calls: 0, checked: 0, mismatches: 0, movedFromAuthority: 0, sameTickPairs: 0, sameTickMotion: 0 },
  };
  let frame = null, driver;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(this, function (now) {
      const outer = frame;
      frame = {
        now, race: false, stepMs: 0, stepCalls: 0, cpuInputMs: 0,
        snapshotMs: 0, perspectiveRenderMs: 0, probeMs: 0,
        buckets: new Set(), include: trace.recording,
      };
      const began = performance.now();
      try {
        return callback.call(this, now);
      } finally {
        const elapsed = performance.now() - began;
        if (frame.race && frame.include) {
          const { race, include, buckets, ...costs } = frame;
          trace.frames.push({ ...costs, callbackMs: elapsed, buckets: [...buckets] });
        }
        frame = outer;
      }
    });
  };
  // Modules publish frozen APIs. Replace only their global export at load time,
  // before the UI captures it, retaining every original method and return value.
  function intercept(name, decorate) {
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => value,
      set: (api) => { value = decorate(api); },
    });
  }
  function timed(fn, field) {
    return function (...args) {
      const began = performance.now();
      try { return fn.apply(this, args); }
      finally { if (frame) frame[field] += performance.now() - began; }
    };
  }
  function checkpoint(state) {
    const a = state.actors[0];
    return { tick: state.tick, raceTick: state.raceTick, lap: a.lap,
      passed: a.passed, recoveries: a.recoveries };
  }
  intercept("SpaceManRace", (api) => Object.freeze({
    ...api,
    cpuInput: timed(api.cpuInput, "cpuInputMs"),
    snapshot: timed(api.snapshot, "snapshotMs"),
    step(...args) {
      const began = performance.now(), result = api.step.apply(this, args),
        ms = performance.now() - began, state = args[0], a = state.actors[0],
        observing = performance.now();
      if (frame) { frame.stepMs += ms; frame.stepCalls++; }
      try {
        if (trace.done || state.phase !== "racing") return result;
        if (!trace.recording) {
          if (a.lap !== 2) return result;
          trace.start = checkpoint(state);
          trace.recording = true;
          if (frame) frame.include = true;
          return result;
        }
        // Read every completed tick: a render can consume several simulation
        // steps, so sampling only snapshots would lose jump/land/pickup events.
        const buckets = new Set();
        for (const e of state.events) {
          trace.events.push({ tick: state.tick, ...e });
          if (e.type === "jump") buckets.add("ramp");
          if (e.type === "land") buckets.add("landing");
          if (e.type === "coin" || e.type === "item") buckets.add("pickup");
          if (["shield", "pulse", "land-pulse", "hit", "block"].includes(e.type))
            buckets.add("item");
        }
        if (state.actors.some((actor) => actor.airRamp)) buckets.add("airborne");
        if (state.effects.length || state.actors.some((actor) => actor.shieldTicks))
          buckets.add("item");
        // There is no collision event/counter. A near-touching pair after the
        // solver is a proxy, not proof of contact or its exact solver cost.
        const active = state.actors.filter((actor) =>
          !actor.dnf && actor.finishTick === null && !actor.recoveryTicks);
        const diameter = api.constants.KART_RADIUS * 2;
        for (let i = 0; i < active.length; i++)
          for (let j = i + 1; j < active.length; j++)
            if ((active[i].controller === "cpu" || active[j].controller === "cpu") &&
                Math.hypot(active[i].x - active[j].x, active[i].y - active[j].y) <= diameter + 0.01)
              buckets.add("cpuContactProxy");
        if (!buckets.size) buckets.add("ordinary");
        trace.steps.push({ tick: state.tick, ms, buckets: [...buckets] });
        if (frame) for (const bucket of buckets) frame.buckets.add(bucket);
        if (a.lap >= 3) {
          trace.end = checkpoint(state);
          trace.recording = false;
          trace.done = true;
        }
        return result;
      } finally {
        if (frame) frame.probeMs += performance.now() - observing;
      }
    },
  }));
  intercept("SpaceManRaceView", (api) => Object.freeze({
    ...api,
    create(...args) {
      const view = api.create.apply(this, args), render = timed(view.render, "perspectiveRenderMs"),
        parent = args[0].root;
      view.render = function (...renderArgs) {
        if (frame) frame.race = true;
        try { return render.apply(this, renderArgs); }
        finally {
          const began = performance.now();
          if (frame) {
            frame.renderer = parent.dataset.renderer;
            frame.quality = frame.renderer === "webgl" ? parent.dataset.quality ?? null : null;
            frame.probeMs += performance.now() - began;
          }
        }
      };
      return view;
    },
  }));
  intercept("SpaceManRacePresentation", (api) => Object.freeze({
    ...api,
    createSampler(...args) {
      const sampler = api.createSampler.apply(this, args), sample = sampler.sample;
      let previousSample = null;
      sampler.sample = function (state, options = {}) {
        const shown = sample.call(this, state, options), began = performance.now();
        try {
          if (!trace.recording || !state || !shown) return shown;
          const a = state.actors.find((actor) => actor.id === options.actorId),
            p = options.previous?.actors.find((actor) => actor.id === a?.id),
            display = shown.actors.find((actor) => actor.id === a?.id),
            alpha = Math.max(0, Math.min(1, options.alpha));
          trace.sampler.calls++;
          // Check the actual UI sampler's output, without manufacturing a frame
          // or changing the authoritative clock. Natural no-step frames are
          // diagnostic only: software CI can run below the physics frequency.
          if (a && p && display && previousSample && !options.network && !options.paused &&
              p.recoveries === a.recoveries && !a.recoveryTicks &&
              Math.hypot(a.x - p.x, a.y - p.y) < 120 && Number.isFinite(alpha)) {
            trace.sampler.checked++;
            const error = Math.hypot(display.x - (p.x + (a.x - p.x) * alpha),
              display.y - (p.y + (a.y - p.y) * alpha));
            if (error > 1e-6) trace.sampler.mismatches++;
            if (Math.hypot(display.x - a.x, display.y - a.y) > 1e-6)
              trace.sampler.movedFromAuthority++;
            if (previousSample.tick === state.tick) {
              trace.sampler.sameTickPairs++;
              if (Math.hypot(display.x - previousSample.x, display.y - previousSample.y) > 1e-6)
                trace.sampler.sameTickMotion++;
            }
          }
          if (display) previousSample = { tick: state.tick, x: display.x, y: display.y };
          return shown;
        } finally {
          if (frame) frame.probeMs += performance.now() - began;
        }
      };
      return sampler;
    },
  }));
  trace.startDriver = () => {
    driver = setInterval(() => {
      const began = performance.now(), s = raceUI.snapshot(),
        snapshotMs = performance.now() - began;
      if (!s || s.phase !== "racing") return;
      const c = SpaceManRace.cpuInput(s, s.actors[0]);
      testPad.axes[0] = c.steer;
      testPad.buttons[0].pressed = c.boost;
      testPad.buttons[1].pressed = c.brake;
      testPad.buttons[5].pressed = c.item;
      if (trace.recording) trace.driver.push({ snapshotMs, totalMs: performance.now() - began });
    }, 16);
  };
  trace.stopDriver = () => {
    clearInterval(driver);
    testPad.axes[0] = 0;
    testPad.buttons.forEach((b) => (b.pressed = false));
  };
}

function timingStats(samples) {
  if (!samples.length) return { count: 0 };
  const sorted = samples.slice().sort((a, b) => a - b),
    q = (p) => Math.round(sorted[Math.floor((sorted.length - 1) * p)] * 100) / 100;
  return {
    count: samples.length, p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: q(1),
    over33Ms: samples.filter((n) => n > 33).length,
    over50Ms: samples.filter((n) => n > 50).length,
  };
}
function summarizeLapTrace(trace) {
  // Attribute an interval to the previous callback's activity: its work precedes
  // the next callback. This is correlation, not a GPU timer or causal attribution.
  const frames = trace.frames.slice(0, -1).map((f, i) => ({
    ...f, intervalMs: trace.frames[i + 1].now - f.now,
  }));
  const buckets = {};
  for (const bucket of ["ordinary", "ramp", "airborne", "landing", "pickup", "item", "cpuContactProxy"])
    buckets[bucket] = {
      intervals: timingStats(frames.filter((f) => f.buckets.includes(bucket)).map((f) => f.intervalMs)),
      simulationSteps: timingStats(trace.steps.filter((s) => s.buckets.includes(bucket)).map((s) => s.ms)),
    };
  const eventCounts = {};
  for (const e of trace.events) {
    const scope = e.id === "pilot-0" ? "player" : "other";
    const key = `${scope}:${e.type}`;
    eventCounts[key] = (eventCounts[key] || 0) + 1;
  }
  return {
    start: trace.start, end: trace.end,
    quality: {
      start: trace.frames[0]?.quality ?? null, end: trace.frames.at(-1)?.quality ?? null,
      changes: trace.frames.slice(1).filter((f, i) => f.quality !== trace.frames[i].quality).length,
      values: [...new Set(trace.frames.map((f) => f.quality))],
    },
    intervals: timingStats(frames.map((f) => f.intervalMs)),
    simulationSteps: timingStats(trace.steps.map((s) => s.ms)),
    raceCallback: timingStats(trace.frames.map((f) => f.callbackMs)),
    stepsPerCallback: {
      count: trace.frames.length,
      zero: trace.frames.filter((f) => f.stepCalls === 0).length,
      one: trace.frames.filter((f) => f.stepCalls === 1).length,
      multiple: trace.frames.filter((f) => f.stepCalls > 1).length,
      max: Math.max(...trace.frames.map((f) => f.stepCalls)),
    },
    cpuInputPerCallback: timingStats(trace.frames.map((f) => f.cpuInputMs)),
    productionSnapshotPerCallback: timingStats(trace.frames.map((f) => f.snapshotMs)),
    perspectiveRenderPerCallback: timingStats(trace.frames.map((f) => f.perspectiveRenderMs)),
    probePerCallback: timingStats(trace.frames.map((f) => f.probeMs)),
    driverCallback: timingStats(trace.driver.map((s) => s.totalMs)),
    driverSnapshot: timingStats(trace.driver.map((s) => s.snapshotMs)),
    eventCounts, buckets, sampler: trace.sampler,
  };
}

test(
  "perspective frame pacing: complete warmed Starlight laps in topdown, chase and cockpit",
  { timeout: 330000 },
  async (t) => {
    for (const camera of ["topdown", "chase", "cockpit"])
      await t.test(camera, { timeout: 105000 }, async (t) => {
        const { page } = await launch(t, {}, installLapTrace);
        await page.locator(`[data-track="${EVIDENCE_TRACK}"]`).click();
        await page.locator(".race-launch").click();
        await page.getByRole("button", { name: "Camera view", exact: true }).click();
        await page.locator(`.race-view-menu [data-camera="${camera}"]`).click();
        await playing(page);
        await page.evaluate(() => raceLapTrace.startDriver());
        // Warm a whole first lap, then trace exactly gates 20 -> 40. All cameras
        // see the same course/lap; no screenshot or polling snapshot runs inside
        // the measured lap, and the driver uses the existing standard-pad path.
        let waitError;
        try {
          await page.waitForFunction(() => raceLapTrace.done, null, {
            polling: 250, timeout: 95000,
          });
        } catch (error) {
          waitError = error;
        } finally {
          await page.evaluate(() => raceLapTrace.stopDriver());
        }
        const trace = await page.evaluate(() => {
          const { frames, steps, events, driver, sampler, start, end } = raceLapTrace;
          return { frames, steps, events, driver, sampler, start, end };
        });
        const summary = {
          browser: process.env.SPACE_MAN_RACE_BROWSER || "chromium", camera,
          renderer: await page.locator(".race-root").getAttribute("data-renderer"),
          ...summarizeLapTrace(trace),
          notes: [
            "Instrumented software browser; not physical-device FPS or GPU timings.",
            "Intervals include application, driver, probe, browser and scheduler work.",
            "Step timing excludes snapshot/driver/probe work; callback timings include test wrappers.",
            "Perspective render excludes HUD and 2D canvas; topdown returns early. Full paint is not isolated.",
            "Boundary callbacks are included; step samples cover the exact second lap.",
            "Buckets can overlap and include all racers; cpuContactProxy is post-step proximity, not a contact counter.",
          ],
        };
        console.log("Complete-lap software-browser diagnostics (not physical-device FPS):", JSON.stringify(summary));
        // Raw JSON is archived by the perspective workflow alongside screenshots.
        // Local runs can opt in with SPACE_MAN_RACE_TRACES.
        if (process.env.SPACE_MAN_RACE_TRACES) {
          await fs.mkdir(process.env.SPACE_MAN_RACE_TRACES, { recursive: true });
          await fs.writeFile(path.join(process.env.SPACE_MAN_RACE_TRACES,
            `${EVIDENCE_TRACK}-${summary.browser}-${camera}.json`), JSON.stringify({
              summary, trace,
            }, null, 2) + "\n");
        }
        assert.ifError(waitError);
        assert.equal(summary.renderer, camera === "topdown" ? "2d" : "webgl");
        assert.ok(trace.frames.every((f) => f.renderer === summary.renderer), "renderer remains stable throughout the lap");
        if (camera === "topdown") {
          assert.ok(trace.sampler.checked > 0, "topdown calls the display-pose sampler");
          assert.equal(trace.sampler.mismatches, 0, "display poses match render-only interpolation");
          assert.ok(trace.sampler.movedFromAuthority > 0, "topdown uses intermediate display poses");
        }
        assert.equal(trace.start.passed, 20);
        assert.equal(trace.end.passed, 40);
        assert.equal(trace.end.recoveries, trace.start.recoveries);
        assert.equal(trace.steps.length, trace.end.tick - trace.start.tick);
        assert.ok(trace.frames.length > 1 && trace.driver.length > 0);
        assert.ok(trace.frames.slice(1).every((f, i) => Number.isFinite(f.now) && f.now > trace.frames[i].now));
        assert.ok(trace.steps.every((s) => Number.isFinite(s.ms) && s.ms >= 0));
        // Retain the old coarse CI stall guard; this is not a 60-FPS target.
        assert.ok(summary.intervals.p95Ms < 80,
          "the complete-lap software-browser trace must avoid sustained severe stalls");
      });
  },
);

// Control measurement: leave simulation, sampler and view APIs untouched. The
// only per-frame probe brackets the existing race tick callback. This excludes
// per-step event scanning, pose assertions and renderer/quality instrumentation.
test('perspective timing control: topdown with only a lightweight callback timer',
  { timeout: 105000 }, async (t) => {
    const { page } = await launch(t, {}, () => {
      window.testPad = { connected: true, mapping: 'standard', index: 0,
        axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [testPad], configurable: true });
      const trace = window.raceTimingControl = { recording: false, done: false, frames: [] },
        raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function (callback) {
        return raf.call(this, function (now) {
          // race-ui schedules its named tick; the parked runner uses frame.
          if (!trace.recording || callback.name !== 'tick') return callback.call(this, now);
          const started = performance.now();
          try { return callback.call(this, now); }
          finally { trace.frames.push({ now, ms: performance.now() - started }); }
        });
      };
    });
    await page.locator('.race-launch').click();
    await page.getByRole('button', { name: 'Camera view', exact: true }).click();
    await page.locator('.race-view-menu [data-camera="topdown"]').click();
    await playing(page);
    await page.evaluate(() => {
      window.timingDriver = setInterval(() => {
        const s = raceUI.snapshot();
        if (!s || s.phase !== 'racing') return;
        const a = s.actors[0], command = SpaceManRace.cpuInput(s, a);
        testPad.axes[0] = command.steer;
        testPad.buttons[0].pressed = command.boost;
        testPad.buttons[1].pressed = command.brake;
        testPad.buttons[5].pressed = command.item;
        raceTimingControl.recording = a.lap === 2;
        if (a.lap >= 3) raceTimingControl.done = true;
      }, 16);
    });
    try { await page.waitForFunction(() => raceTimingControl.done, null, { polling: 250, timeout: 95000 }); }
    finally {
      await page.evaluate(() => {
        clearInterval(timingDriver); testPad.axes[0] = 0;
        testPad.buttons.forEach(button => { button.pressed = false; });
      });
    }
    const frames = await page.evaluate(() => raceTimingControl.frames), summary = {
      browser: process.env.SPACE_MAN_RACE_BROWSER || 'chromium',
      camera: 'topdown', probe: 'RAF callback timer only',
      intervals: timingStats(frames.slice(1).map((f, i) => f.now - frames[i].now)),
      callback: timingStats(frames.map(f => f.ms)),
      note: 'Software-browser control, not uninstrumented device FPS; two timer reads per recorded callback and the ordinary test driver remain.',
    };
    console.log('Lightweight topdown timing control:', JSON.stringify(summary));
    if (process.env.SPACE_MAN_RACE_TRACES) {
      await fs.mkdir(process.env.SPACE_MAN_RACE_TRACES, { recursive: true });
      await fs.writeFile(path.join(process.env.SPACE_MAN_RACE_TRACES,
        `starlight-${summary.browser}-topdown-control.json`), JSON.stringify({ summary, frames }, null, 2) + '\n');
    }
    assert.ok(frames.length > 1, 'the unchanged race tick callback was timed');
    assert.ok(frames.every(f => Number.isFinite(f.ms) && f.ms >= 0));
    assert.equal(await page.locator('.race-root').getAttribute('data-renderer'), '2d');
  });

// Visual evidence runs separately from both timing tests above. Only standard
// gamepad input drives the racer; the step wrapper observes completed ticks and
// never edits the simulation, its clock, events, camera poses or actor state.
function installLapVisualEvidence() {
  window.testPad = {
    connected: true, mapping: "standard", index: 0, axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [testPad], configurable: true,
  });
  const evidence = window.raceLapVisualEvidence = {
    recording: false, done: false, start: null, end: null,
    playerEvents: [], heldItems: [], maxPlayerHeight: 0, driverSamples: 0,
  };
  let api, driver;
  function checkpoint(state) {
    const a = state.actors[0], c = api.course(state.trackId);
    return {
      tick: state.tick, raceTick: state.raceTick, phase: state.phase,
      lap: a.lap, passed: a.passed, progress: a.progress,
      courseS: api.nearest(c, a.x, a.y).s, recoveries: a.recoveries,
      airRamp: a.airRamp, airTicks: a.airTicks, z: a.z,
      item: a.item, shieldTicks: a.shieldTicks,
      playerPulsePhases: state.effects.filter(e => e.ownerId === a.id).map(e => e.phase),
    };
  }
  Object.defineProperty(window, "SpaceManRace", {
    configurable: true,
    get: () => api,
    set(value) {
      api = Object.freeze({
        ...value,
        step(...args) {
          const result = value.step.apply(this, args), state = args[0], a = state.actors[0];
          if (!evidence.recording || state.phase !== "racing") return result;
          evidence.maxPlayerHeight = Math.max(evidence.maxPlayerHeight, a.z);
          if (a.item && !evidence.heldItems.includes(a.item)) evidence.heldItems.push(a.item);
          for (const event of state.events)
            if (event.id === a.id) evidence.playerEvents.push({ tick: state.tick, ...event });
          if (a.passed >= api.constants.GATES) {
            evidence.end = checkpoint(state);
            evidence.recording = false;
            evidence.done = true;
          }
          return result;
        },
      });
    },
  });
  evidence.sample = () => checkpoint(raceUI.snapshot());
  evidence.startDriver = () => {
    evidence.start = evidence.sample();
    evidence.recording = true;
    driver = setInterval(() => {
      const state = raceUI.snapshot();
      if (!evidence.recording || state?.phase !== "racing") return;
      const command = api.cpuInput(state, state.actors[0]);
      testPad.axes[0] = command.steer;
      for (const [index, pressed] of [[0, command.boost], [1, command.brake], [5, command.item]]) {
        testPad.buttons[index].pressed = pressed;
        testPad.buttons[index].value = pressed ? 1 : 0;
      }
      evidence.driverSamples++;
    }, 16);
  };
  evidence.stopDriver = () => {
    clearInterval(driver);
    testPad.axes[0] = 0;
    testPad.buttons.forEach(button => { button.pressed = false; button.value = 0; });
  };
}

test(
  "perspective art evidence: complete first Starlight laps in three phone cameras",
  { timeout: 295000 },
  async (t) => {
    // Six Starlight or eight Prism first laps, with no warm-up. Prism adds
    // compact phone and tablet evidence; these screenshots are not FPS samples.
    const views=["portrait", "landscape"].flatMap(orientation => ["topdown", "chase", "cockpit"].map(camera => ({orientation,camera})));
    if(EVIDENCE_TRACK==='prism') views.push({orientation:'small-phone',camera:'cockpit'}, {orientation:'tablet',camera:'chase'});
    for (const {orientation,camera} of views)
        await t.test(`${orientation} ${camera}`, { timeout: 48000 }, async (t) => {
          const deadline = Date.now() + 45000,
            viewport = orientation === "small-phone" ? {width:320,height:568} : orientation === "tablet" ? {width:820,height:1180} : orientation === "portrait"
              ? { width: 390, height: 844 } : { width: 844, height: 390 },
            { page } = await launch(t, {
              viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
            }, installLapVisualEvidence);
          await page.locator(`[data-track="${EVIDENCE_TRACK}"]`).click();
          await page.locator(".race-launch").click();
          await page.getByRole("button", { name: "Camera view", exact: true }).click();
          await page.locator(`.race-view-menu [data-camera="${camera}"]`).click();
          await playing(page);
          const checkpoints = await page.evaluate(trackId => {
            const course = SpaceManRace.course(trackId), features = SpaceManRace.features(course),
              progress = s => s / course.length * SpaceManRace.constants.GATES;
            if (trackId === 'prism') return [
              { name: "boost-approach", progress: 2.6 },
              { name: "ramp-rise", progress: progress(features.ramps[0].s - 25) },
              { name: "landing", progress: progress(features.ramps[0].s + 240) },
              { name: "gallery-entry", progress: 11.35 },
              { name: "gallery-interior", progress: 12.5 },
              { name: "spacious-finish", progress: 18.6 },
            ];
            return [
              { name: "start", progress: 0 },
              { name: "ramp-approach", progress: progress(features.ramps[0].startS - 125) },
              // This names the authored sky-coin location, not an assertion
              // that the player is airborne when the screenshot is taken.
              { name: "airborne-pickup-lane", progress: progress(features.ramps[0].s + 54) },
              { name: "shield-pulse-decision", progress: progress(features.rows[0].s - 140) },
              { name: "return-to-finish", progress: progress(course.length - 300) },
            ];
          }, EVIDENCE_TRACK);
          const captures = [];
          let runError;
          await page.evaluate(() => raceLapVisualEvidence.startDriver());
          try {
            for (const checkpoint of checkpoints) {
              if (orientation === "landscape" &&
                  ["start", "airborne-pickup-lane"].includes(checkpoint.name)) continue;
              await page.waitForFunction(target =>
                raceLapVisualEvidence.sample().progress >= target,
              checkpoint.progress, { polling: "raf", timeout: Math.max(1, deadline - Date.now()) });
              const before = await page.evaluate(() => raceLapVisualEvidence.sample()),
                name = `${EVIDENCE_TRACK}-lap-${orientation}-${camera}-${checkpoint.name}`;
              await capture(page, name);
              const after = await page.evaluate(() => raceLapVisualEvidence.sample());
              captures.push({
                checkpoint: checkpoint.name, requestedProgress: checkpoint.progress,
                screenshot: process.env.SPACE_MAN_RACE_SCREENSHOTS ? name + ".png" : null,
                before, after,
                playerAirborneAtBothSamples: !!before.airRamp && before.airRamp === after.airRamp,
              });
            }
            await page.waitForFunction(() => raceLapVisualEvidence.done, null, {
              polling: 100, timeout: Math.max(1, deadline - Date.now()),
            });
          } catch (error) {
            runError = error;
          } finally {
            await page.evaluate(() => raceLapVisualEvidence.stopDriver());
          }
          const observed = await page.evaluate(() => {
            const { start, end, playerEvents, heldItems, maxPlayerHeight, driverSamples } = raceLapVisualEvidence;
            return { start, end, playerEvents, heldItems, maxPlayerHeight, driverSamples };
          });
          const report = {
            browser: process.env.SPACE_MAN_RACE_BROWSER || "chromium", orientation, viewport, camera,
            renderer: await page.locator(".race-root").getAttribute("data-renderer"),
            completedLap: !!observed.end, captures, ...observed,
            error: runError?.message ?? null,
            notes: [
              "Actual first-lap standard-gamepad traversal; no state injection, teleport, warm-up or timing claims.",
              "Portrait covers start, ramp approach, sky-coin lane, Shield/Pulse decision and return to finish.",
              "Landscape covers ramp approach, Shield/Pulse decision and return to finish; every view still completes a lap.",
              "Checkpoint names describe course regions. Events are observed on completed simulation ticks, not inferred from images.",
              "Before/after samples bracket capture, not the exact rendered frame. A jump may be observed without being caught in a screenshot.",
              "The unchanged CPU driver chooses items normally; seeing the two-choice row does not establish both item activations.",
            ],
          };
          t.diagnostic(JSON.stringify(report));
          const directory = process.env.SPACE_MAN_RACE_SCREENSHOTS || process.env.SPACE_MAN_RACE_TRACES;
          if (directory) {
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(path.join(directory,
              `${EVIDENCE_TRACK}-lap-${report.browser}-${orientation}-${camera}.json`), JSON.stringify(report, null, 2) + "\n");
          }
          assert.ifError(runError);
          assert.equal(report.renderer, camera === "topdown" ? "2d" : "webgl");
          assert.equal(observed.start.passed, 0);
          assert.equal(observed.end.passed, 20, "the driver completed all ordered gates of the first lap");
          assert.equal(observed.end.recoveries, observed.start.recoveries);
          assert.ok(observed.driverSamples > 0);
          assert.equal(captures.length, EVIDENCE_TRACK === "prism" ? 6 : orientation === "portrait" ? 5 : 3);
          if(EVIDENCE_TRACK === "prism") {
            assert.ok(observed.playerEvents.some(e => e.type === "jump"), "real ramp traversal");
            assert.ok(observed.playerEvents.some(e => e.type === "land"), "real landing");
          }
          assert.ok(captures.every(c => c.before.lap === 1), "all checkpoint captures begin on the first lap");
          assert.ok(captures.slice(1).every((c, i) => c.before.tick > captures[i].before.tick));
        });
  },
);
