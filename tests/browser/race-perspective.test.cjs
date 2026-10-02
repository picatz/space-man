// Real browser tests for Star Circuit's production UI and fixed-tick simulation.
// The actual title launcher parks the runner and restores it on exit.
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  http = require("node:http"),
  path = require("node:path");
const { chromium, webkit } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
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
    await menu(page, "Back to runner");
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
    await menu(page, "Back to runner");
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
      await page.keyboard.press("r");
      await page.waitForFunction(
        (n) => raceUI.snapshot().actors[0].recoveries > n,
        recoveries,
      );
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
