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
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
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

test(
  "race desktop: setup, genuine steering/boost/brake, pause/restart, all circuits, clean close",
  { timeout: 70000 },
  async (t) => {
    const { page } = await launch(t);
    assert.equal(await page.locator(".race-track").count(), 3);
    assert.equal(await page.locator(".race-segment").count(), 3);
    await capture(page, "race-lobby-desktop");
    await page.locator(".race-launch").click();
    await playing(page);
    const start = await page.evaluate(() => raceUI.snapshot());
    assert.equal(start.actors.length, 5);
    await page.waitForFunction(() => raceUI.snapshot().actors[0].speed > 3);
    const h = await page.evaluate(() => raceUI.snapshot().actors[0].heading);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(160);
    await page.keyboard.up("ArrowRight");
    assert.ok(
      Math.abs(
        (await page.evaluate(() => raceUI.snapshot().actors[0].heading)) - h,
      ) > 0.1,
    );
    await page.keyboard.down("Space");
    await page.waitForFunction(() => raceUI.snapshot().actors[0].boosting);
    await page.keyboard.up("Space");
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowDown");
    assert.ok(
      (await page.evaluate(() => raceUI.snapshot().actors[0].speed)) < 5,
    );
    await capture(page, "race-desktop-driving");
    await page.keyboard.press("Escape");
    await screen(page, "pause");
    const tick = await page.evaluate(() => raceUI.snapshot().tick);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => raceUI.snapshot().tick), tick);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        () => document.activeElement.closest(".race-dialog") !== null,
      ),
      true,
    );
    await menu(page, "Restart race");
    assert.equal(
      await page.evaluate(() => raceUI.snapshot().phase),
      "countdown",
    );
    await page.keyboard.press("Escape");
    await menu(page, "Choose a circuit");
    for (const id of ["ember", "bloom"]) {
      await page.locator(`[data-track="${id}"]`).click();
      await page.locator(".race-launch").click();
      await playing(page);
      assert.equal(await page.evaluate(() => raceUI.snapshot().trackId), id);
      await page.waitForTimeout(300);
      await capture(page, "race-circuit-" + id);
      await page.keyboard.press("Escape");
      await menu(page, "Choose a circuit");
    }
    await menu(page, "← Back to runner");
    assert.equal(await page.evaluate(() => raceUI.active), false);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "btnRace",
    );
    await page.locator("#btnRace").click();
    await screen(page, "lobby");
    await menu(page, "← Back to runner");
    assert.equal(
      await page.locator(".race-root").count(),
      1,
      "one lazy root after repeated open",
    );
    await page.locator("#btnPlay").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.down("d");
    await page.waitForFunction(() => G.mode === "play" && G.player.vx > 0);
    await page.keyboard.up("d");
  },
);

test(
  "race desktop: drive a complete three-lap race through standard gamepad commands and rematch",
  { timeout: 90000 },
  async (t) => {
    const { page } = await launch(t, {}, () => {
      const buttons = Array.from({ length: 17 }, () => ({
        pressed: false,
        value: 0,
      }));
      window.testPad = {
        connected: true,
        mapping: "standard",
        index: 0,
        axes: [0, 0],
        buttons,
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [window.testPad],
        configurable: true,
      });
    });
    await page.locator(".race-launch").click();
    await playing(page);
    // A test driver reads the public snapshot and applies normal controller inputs.
    // It neither mutates race state nor bypasses physics/checkpoints/the UI loop.
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
    await screen(page, "results");
    await page.evaluate(() => {
      clearInterval(driver);
      testPad.axes[0] = 0;
      testPad.buttons.forEach((b) => (b.pressed = false));
    });
    const s = await page.evaluate(() => raceUI.snapshot());
    assert.equal(s.actors[0].passed, 60);
    assert.equal(s.actors[0].recoveries, 0);
    assert.ok(s.actors[0].finishTick > 600);
    assert.equal(s.results.length, 5);
    await capture(page, "race-results-desktop");
    await menu(page, "Race again");
    assert.equal(
      await page.evaluate(() => raceUI.snapshot().phase),
      "countdown",
    );
    assert.equal(
      await page.evaluate(() => raceUI.snapshot().actors[0].passed),
      0,
    );
  },
);

test(
  "race mobile: touch cancel/release, resume, rotation and safe-area layouts",
  { timeout: 50000 },
  async (t) => {
    const { page, context } = await launch(t, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await capture(page, "race-lobby-phone");
    await page.locator(".race-launch").tap();
    await playing(page);
    for (const action of ["left", "right", "brake", "boost"]) {
      const b = await page.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(
        b.width >= 48 &&
          b.height >= 48 &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= 391 &&
          b.y + b.height <= 845,
      );
    }
    const right = page.locator('[data-action="right"]'),
      b = await right.boundingBox(),
      x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    const h = await page.evaluate(() => raceUI.snapshot().actors[0].heading);
    if (engine === chromium) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 0, x, y }],
      });
      await page.waitForTimeout(150);
      assert.ok(
        Math.abs(
          (await page.evaluate(() => raceUI.snapshot().actors[0].heading)) - h,
        ) > 0.1,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
    } else {
      await right.dispatchEvent("pointerdown", {
        pointerId: 18,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: y,
      });
      await page.waitForTimeout(150);
      assert.ok(
        Math.abs(
          (await page.evaluate(() => raceUI.snapshot().actors[0].heading)) - h,
        ) > 0.1,
      );
      await page.evaluate(() =>
        window.dispatchEvent(
          new PointerEvent("pointercancel", {
            pointerId: 18,
            pointerType: "touch",
          }),
        ),
      );
    }
    assert.equal(await page.locator(".race-pressed").count(), 0);
    const releaseHeading = await page.evaluate(
      () => raceUI.snapshot().actors[0].heading,
    );
    await page.waitForTimeout(120);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => raceUI.snapshot().actors[0].heading)) -
          releaseHeading,
      ) < 0.02,
      "canceled steering is not stuck",
    );
    await page.getByRole("button", { name: "Pause race" }).tap();
    await screen(page, "pause");
    await page.getByRole("button", { name: "Resume race", exact: true }).tap();
    await screen(page, "play");
    await capture(page, "race-phone-driving");
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(120);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await capture(page, "race-phone-landscape");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(120);
    for (const action of ["left", "right", "brake", "boost"]) {
      const b = await page.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 321 && b.y + b.height <= 569);
    }
    await page.getByRole("button", { name: "Pause race" }).tap();
    await page
      .getByRole("button", { name: "Back to runner", exact: true })
      .filter({ visible: true })
      .tap();
    assert.equal(await page.evaluate(() => raceUI.active), false);
    await page.locator("#btnRace").tap();
    await screen(page, "lobby");
    await capture(page, "race-lobby-small-phone");
  },
);

test(
  "race mobile: global release, viewport interrupt, visibility pause and settings reuse",
  { timeout: 40000 },
  async (t) => {
    const { page } = await launch(t, {
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    await page.evaluate(() => {
      prefs.lefty = true;
      prefs.reduceMotion = true;
      prefs.keys = { left: "q" };
      prefs.batterySaver = true;
    });
    await page.locator(".race-launch").tap();
    await playing(page);
    assert.equal(
      await page.locator(".race-root").getAttribute("data-handed"),
      "left",
    );
    assert.equal(
      await page.locator(".race-root").getAttribute("data-calm"),
      "true",
    );
    assert.equal(
      await page.evaluate(() => document.querySelector(".race-canvas").width),
      844,
    );
    const b = page.locator('[data-action="left"]');
    await b.dispatchEvent("pointerdown", {
      pointerId: 55,
      pointerType: "touch",
      isPrimary: true,
    });
    await page.waitForTimeout(100);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 55, pointerType: "touch" }),
      ),
    );
    assert.equal(await page.locator(".race-pressed").count(), 0);
    await b.dispatchEvent("pointerdown", {
      pointerId: 56,
      pointerType: "touch",
      isPrimary: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".race-pressed").count(), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen(page, "pause");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByRole("button", { name: "Resume race", exact: true }).tap();
    await screen(page, "play");
    const h = await page.evaluate(() => raceUI.snapshot().actors[0].heading);
    await page.keyboard.down("q");
    await page.waitForTimeout(100);
    await page.keyboard.up("q");
    assert.ok(
      Math.abs(
        (await page.evaluate(() => raceUI.snapshot().actors[0].heading)) - h,
      ) > 0.1,
    );
    await page.getByRole("button", { name: "Pause race" }).tap();
    await capture(page, "race-pause-phone");
  },
);

test(
  "race mobile: shared preview/status rail and narrow safe insets leave controls clear",
  { timeout: 30000 },
  async (t) => {
    const { page } = await launch(t, {
      viewport: { width: 320, height: 664 },
      isMobile: true,
      hasTouch: true,
    });
    await page.evaluate(() => {
      const s = document.documentElement.style;
      s.setProperty("--game-ui-top", "38px");
      s.setProperty("--game-ui-bottom", "24px");
      s.setProperty("--game-ui-left", "8px");
      s.setProperty("--game-ui-right", "8px");
      const rail = document.createElement("div");
      rail.textContent = "PREVIEW · PR #32 · layout verification";
      rail.style.cssText =
        "position:fixed;z-index:2000;top:0;left:0;right:0;height:30px;padding:7px 12px;background:#191b31;color:#bccbdf;font:10px system-ui";
      document.body.append(rail);
    });
    await page.locator(".race-launch").tap();
    await playing(page);
    const hud = await page.locator(".race-hud").boundingBox();
    assert.ok(hud.y >= 49, "HUD clears shared status rail");
    const boxes = [];
    for (const action of ["left", "right", "brake", "boost"]) {
      const b = await page.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(
        b.width >= 48 &&
          b.height >= 48 &&
          b.x >= 8 &&
          b.x + b.width <= 312 &&
          b.y + b.height <= 641,
      );
      boxes.push(b);
    }
    const rescue = await page.locator(".race-recover").boundingBox();
    assert.ok(rescue.width >= 44);
    for (const b of boxes)
      assert.ok(
        rescue.x + rescue.width <= b.x ||
          rescue.x >= b.x + b.width ||
          rescue.y + rescue.height <= b.y ||
          rescue.y >= b.y + b.height,
        "rescue does not cover another touch action",
      );
    await capture(page, "race-phone-preview-insets");
    await page.getByRole("button", { name: "Pause race" }).tap();
    await menu(page, "Choose a circuit");
    await page.locator(".race-launch").scrollIntoViewIfNeeded();
    await capture(page, "race-setup-small-phone");
  },
);

test(
  "race mobile: OS reduced motion fallback and explicit preference override",
  { timeout: 25000 },
  async (t) => {
    const { page } = await launch(t, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    assert.equal(
      await page.locator(".race-root").getAttribute("data-calm"),
      "true",
    );
    await page.locator(".race-launch").tap();
    await playing(page);
    await capture(page, "race-reduced-motion-phone");
    await page.getByRole("button", { name: "Pause race" }).tap();
    await menu(page, "Choose a circuit");
    await page.evaluate(() => {
      prefs.reduceMotion = false;
    });
    await page.locator(".race-launch").tap();
    assert.equal(
      await page.locator(".race-root").getAttribute("data-calm"),
      "false",
    );
  },
);
