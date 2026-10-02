// Real Chromium UI regression. Local assets only, no relay or online-PvP claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');

async function launch(t, device = {}, init) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] || 'text/plain';
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => {
    if (browser && process.env.SPACE_MAN_ARENA_SCREENSHOTS) {
      try {
        await fs.mkdir(process.env.SPACE_MAN_ARENA_SCREENSHOTS, { recursive: true });
        for (const context of browser.contexts()) for (const p of context.pages()) {
          await p.screenshot({ path: path.join(process.env.SPACE_MAN_ARENA_SCREENSHOTS, 'last-' + (device.hasTouch ? 'phone' : 'desktop') + '-' + Date.now() + '.png') });
        }
      } catch (_) { /* Diagnostics never replace a test result. */
      }
    }
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // A missing asset must return a real 404 without crashing the server or
  // preventing subsequent requests from succeeding.
  const missing = await fetch(base + '/__missing_arena_test_asset__.js');
  assert.equal(missing.status, 404); await missing.arrayBuffer();
  const available = await fetch(base + '/src/arena.js');
  assert.equal(available.status, 200);
  assert.match(await available.text(), /SpaceManArena/);
  const engine = process.env.SPACE_MAN_ARENA_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...device });
  await context.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), pending = new Set();
    window.requestAnimationFrame = fn => {
      const id = request(time => { pending.delete(id); fn(time); }); pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); return cancel(id); };
    Object.defineProperty(window, '__arenaRafPending', { get: () => pending.size });
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(), errors = [], sockets = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', ws => sockets.push(ws.url()));
  await page.goto(base + '/');
  await page.locator('#btnArena').waitFor();
  t.after(() => { assert.deepEqual(errors, [], 'no uncaught browser errors'); assert.deepEqual(sockets, [], 'CPU arena never opens a relay socket'); });
  return { page, context, errors, sockets };
}
async function screen(page, value) { await page.locator(`.arena-root[data-screen="${value}"]`).waitFor(); }
async function playing(page) { await page.waitForFunction(() => arenaUI.snapshot()?.phase === 'playing'); }
async function pause(page) { await page.keyboard.press('Escape'); await screen(page, 'pause'); }
async function capture(page, name) {
  if (!process.env.SPACE_MAN_ARENA_SCREENSHOTS) return;
  await fs.mkdir(process.env.SPACE_MAN_ARENA_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SPACE_MAN_ARENA_SCREENSHOTS, name + '.png') });
}

test('arena desktop: launcher, real controls, pause, result/rematch, stage formats and safe runner return', { timeout: 90000 }, async t => {
  const { page } = await launch(t);
  await page.evaluate(() => { localStorage.setItem('sm2.best', '4321'); window.runnerAtArenaLaunch = G.player; });
  await page.locator('#btnArena').click(); await screen(page, 'lobby');
  assert.equal(await page.locator('.arena-stage-card').count(), 3);
  assert.equal(await page.locator('.arena-format-card').count(), 3);
  await capture(page, 'arena-lobby-desktop');
  await page.locator('.arena-launch').click(); await playing(page);
  const start = await page.evaluate(() => arenaUI.snapshot());
  assert.equal(start.actors.length, 2);
  assert.equal(start.actors[0].controller, 'human');
  assert.equal(start.actors[1].controller, 'cpu');
  await page.keyboard.down('d'); await page.waitForTimeout(160); await page.keyboard.up('d');
  assert.ok((await page.evaluate(() => arenaUI.snapshot().actors[0].x)) > start.actors[0].x + 5);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await page.keyboard.up('Space');
  // Exercise dash while the initial spawn shield is still intact. A pulse
  // deliberately drops that shield; testing dash afterward can legitimately
  // reject the input during a CPU's hitstun, depending on its seeded behavior.
  await page.keyboard.press('Shift'); await page.waitForFunction(() => arenaUI.snapshot().actors[0].dashCooldown > 0);
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].dashTicks === 0);
  await page.keyboard.press('f'); await page.waitForFunction(() => arenaUI.snapshot().actors[0].attackSerial > 0);
  await page.waitForTimeout(500);
  await capture(page, 'arena-match-desktop');
  await pause(page);
  const pausedTick = await page.evaluate(() => arenaUI.snapshot().tick);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => arenaUI.snapshot().tick), pausedTick);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.arena-dialog') !== null), true, 'focus stays in arena modal');
  await page.getByRole('button', { name: 'Restart match', exact: true }).click(); await playing(page);
  // Lose a real match using ordinary movement; results are not manufactured by a QA hook.
  await page.keyboard.down('d');
  await page.locator('.arena-root[data-screen="results"]').waitFor({ timeout: 35000 });
  await page.keyboard.up('d');
  assert.equal(await page.evaluate(() => arenaUI.snapshot().phase), 'over');
  assert.equal(await page.locator('.arena-roster [data-actor="1"] .arena-stocks').innerText(), '○○○', 'final HUD refresh agrees with zero remaining lives');
  assert.equal(await page.locator('.arena-roster [data-actor="1"] .arena-damage').innerText(), 'OUT');
  await capture(page, 'arena-results-desktop');
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  assert.equal(await page.evaluate(() => arenaUI.snapshot().phase), 'countdown');
  await pause(page);
  await page.getByRole('button', { name: 'Choose a match', exact: true }).click(); await screen(page, 'lobby');
  for (const [format, stage] of [['ffa', 'bloom-reactor'], ['teams', 'ember-foundry']]) {
    await page.locator(`.arena-format-card[data-format="${format}"]`).click();
    await page.locator(`.arena-stage-card[data-arena="${stage}"]`).click();
    await page.locator('.arena-launch').click();
    const snapshot = await page.evaluate(() => arenaUI.snapshot());
    assert.equal(snapshot.actors.length, 4); assert.equal(snapshot.format, format); assert.equal(snapshot.arenaId, stage);
    if (format === 'teams') assert.deepEqual(snapshot.actors.map(a => a.team), [0, 0, 1, 1]);
    await playing(page); await page.waitForTimeout(750);
    await capture(page, 'arena-stage-' + stage);
    await pause(page);
    await page.getByRole('button', { name: 'Choose a match', exact: true }).click();
  }
  await page.getByRole('button', { name: /Back to runner/ }).filter({ visible: true }).click();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => G.player === window.runnerAtArenaLaunch), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('sm2.best')), '4321');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnArena');
  // The existing runner CTA intentionally pulses forever; use its native
  // keyboard activation rather than waiting for a motionless click target.
  await page.locator('#btnPlay').focus(); await page.keyboard.press('Enter'); await page.keyboard.down('d');
  await page.waitForFunction(() => G.mode === 'play' && G.player.vx > 0);
  await page.keyboard.up('d');
});

test('arena phone: readable controls, multi-touch movement/release, rotation and remapped keyboard', { timeout: 60000 }, async t => {
  const { page, context } = await launch(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluate(() => { settings.reduceMotion = true; settings.muted = true; settings.batterySaver = true; settings.keys.jump = 'q'; });
  await page.locator('#btnArena').tap(); await screen(page, 'lobby');
  await capture(page, 'arena-lobby-phone');
  await page.locator('.arena-launch').tap(); await playing(page);
  const root = page.locator('.arena-root');
  assert.equal(await root.getAttribute('data-calm'), 'true');
  assert.equal(await root.getAttribute('data-saver'), 'true');
  for (const name of ['jump', 'attack', 'dash']) {
    const r = await page.locator('.arena-touch-' + name).boundingBox();
    assert.ok(r && r.width >= 48 && r.height >= 48 && r.x >= 0 && r.y >= 0 && r.x + r.width <= 391 && r.y + r.height <= 845, name + ' is visible and thumb-sized');
  }
  const cdp = await context.newCDPSession(page);
  const stick = await page.locator('.arena-stick-zone').boundingBox();
  const x = stick.x + stick.width * .4, y = stick.y + stick.height * .6;
  const before = await page.evaluate(() => arenaUI.snapshot().actors[0].x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: x + 40, y }] });
  await page.waitForTimeout(180);
  assert.ok((await page.evaluate(() => arenaUI.snapshot().actors[0].x)) > before + 5);
  const jump = await page.locator('.arena-touch-jump').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: x + 40, y }, { id: 1, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 }] });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.arena-pressed').count(), 0, 'cancel clears touch capture and visual holds');
  await page.keyboard.press('q');
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].jumpCount === 2);
  await page.waitForTimeout(750); // photograph play after the brief GO overlay clears
  await capture(page, 'arena-match-phone');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await capture(page, 'arena-match-phone-landscape');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(100);
  const tabletJump = await page.locator('.arena-touch-jump').boundingBox();
  assert.ok(tabletJump && tabletJump.width >= 48 && tabletJump.x + tabletJump.width <= 769 && tabletJump.y + tabletJump.height <= 1025);
  await capture(page, 'arena-match-tablet');
  await page.locator('[aria-label="Pause match"]').tap(); await screen(page, 'pause');
  await page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }).tap();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => input.left || input.right || input.jumpHeld), false);
});

test('arena browser gamepad mapping and held-button mode-boundary guard', { timeout: 35000 }, async t => {
  const { page } = await launch(t);
  await page.evaluate(() => {
    window.testPad = { connected: true, mapping: 'standard', index: 0, id: 'Standard test controller', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.locator('#btnArena').click();
  await page.locator('.arena-launch').focus(); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await playing(page);
  assert.ok(await page.evaluate(() => window.__arenaRafPending <= 2), 'one runner frame and one arena frame after controller launch');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; }); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; window.testPad.axes[0] = .8; });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vx > 1);
  await page.evaluate(() => { window.testPad.axes[0] = 0; window.testPad.buttons[9].pressed = true; });
  await screen(page, 'pause');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; });
  await page.waitForTimeout(80);
  const pausedTick = await page.evaluate(() => arenaUI.snapshot().tick);
  await page.getByRole('button', { name: 'Resume match', exact: true }).focus();
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(tick => arenaUI.snapshot().tick > tick, pausedTick);
  assert.ok(await page.evaluate(() => window.__arenaRafPending <= 2), 'controller resume cannot add another frame chain');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; }); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[9].pressed = true; }); await screen(page, 'pause');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; }); await page.waitForTimeout(80);
  await page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }).focus();
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(() => !arenaUI.active);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => G.mode), 'attract');
  assert.equal(await page.evaluate(() => arenaUI.active), false, 'held A cannot reopen arena');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; });
  await page.waitForFunction(() => !arenaPadNeutral);
});

// These dimensions include the short content area left by an in-app browser's
// top/bottom chrome. A second pass independently constrains visualViewport.
test('arena mobile setup fits short viewports without horizontal overflow', { timeout: 90000 }, async t => {
  const { page } = await launch(t, { viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.locator('#btnArena').tap(); await screen(page, 'lobby');
  async function noHorizontalOverflow() {
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.arena-lobby, .arena-lobby-grid, .arena-setup, .arena-choice-group, .arena-formats, .arena-stage-cards, .arena-format-card, .arena-stage-card, .arena-difficulty'))
      .filter(n => n.scrollWidth > n.clientWidth + 1).map(n => ({ class: n.className, width: n.clientWidth, scroll: n.scrollWidth })));
    assert.deepEqual(overflow, [], 'no hidden or scrollable horizontal overflow in setup');
  }
  for (const [w, h] of [[390, 640], [320, 568], [375, 667], [430, 740], [844, 320]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForFunction(([w, h]) => Math.abs(visualViewport.width - w) < 1 && Math.abs(visualViewport.height - h) < 1 && Math.abs(document.querySelector('.arena-root').getBoundingClientRect().width - w) < 1, [w, h]);
    await page.locator('.arena-lobby').evaluate(n => { n.scrollTop = 0; });
    await noHorizontalOverflow();
    const setup = await page.locator('.arena-setup').boundingBox();
    if (w <= 650) assert.ok(setup.y < 190, 'phone setup starts near the top instead of below a decorative hero');
    if (w === 390) {
      const launchBox = await page.locator('.arena-launch').boundingBox();
      assert.ok(launchBox.y + launchBox.height <= h, 'launch is visible in the initial short phone viewport');
    }
    for (const selector of ['.arena-format-card', '.arena-stage-card', '.arena-segment']) {
      for (const control of await page.locator(selector).all()) {
        await control.scrollIntoViewIfNeeded(); await control.tap();
        assert.equal(await control.getAttribute('aria-pressed'), 'true');
        const b = await control.boundingBox();
        assert.ok(b.x >= -1 && b.x + b.width <= w + 1 && b.y >= -1 && b.y + b.height <= h + 1, 'selected control remains reachable');
      }
    }
    await page.locator('.arena-format-card').first().focus();
    await noHorizontalOverflow();
    await page.locator('.arena-lobby').evaluate(n => { n.scrollTop = 0; });
    await capture(page, `arena-setup-${process.env.SPACE_MAN_ARENA_BROWSER || 'chromium'}-${w}x${h}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.testVisual = { width: 390, height: 590, offsetLeft: 0, offsetTop: 28 };
    for (const name of Object.keys(testVisual)) Object.defineProperty(visualViewport, name, { configurable: true, get: () => testVisual[name] });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(60);
  await page.locator('.arena-lobby').evaluate(n => { n.scrollTop = 0; });
  await noHorizontalOverflow();
  for (const selector of ['#arenaBack', '.arena-format-card', '.arena-stage-card', '.arena-segment', '.arena-launch']) {
    for (const control of await page.locator(selector).all()) {
      await control.scrollIntoViewIfNeeded();
      const b = await control.boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 391 && b.y >= 27 && b.y + b.height <= 619, `${selector} fits the visible in-app area`);
    }
  }
  await capture(page, `arena-setup-${process.env.SPACE_MAN_ARENA_BROWSER || 'chromium'}-in-app`);
  await page.locator('.arena-launch').tap(); await screen(page, 'match');
  await page.locator('[aria-label="Pause match"]').tap(); await screen(page, 'pause');
  for (const control of await page.locator('.arena-small-panel:not([hidden]) button').all()) {
    await control.scrollIntoViewIfNeeded(); const b = await control.boundingBox();
    assert.ok(b.y >= 27 && b.y + b.height <= 619, 'pause actions remain reachable in the visual viewport');
  }
  await page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }).tap();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.locator('#btnArena').isVisible(), true);
  await page.locator('#btnArena').tap(); await screen(page, 'lobby');
  assert.equal(await page.evaluate(() => arenaUI.active), true, 'the next deliberate touch is not swallowed by the delayed-click guard');
  await page.locator('#arenaBack').tap();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
});

test('arena touch recovers from outside release, lost capture, interruptions and mode changes', { timeout: 90000 }, async t => {
  const { page, context } = await launch(t, { viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  // Observe real UI commands at the simulation seam, without changing physics,
  // CPU decisions or player state; knockback cannot mask a stuck-input failure.
  await page.evaluate(() => {
    const original = SpaceManArena;
    window.inputEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchend', 'click', 'blur']) window.addEventListener(type, e => {
      inputEvents.push({ type, id: e.pointerId, primary: e.isPrimary, target: e.target.id || e.target.className || e.target.tagName, screen: arenaUI?.screen });
      if (inputEvents.length > 35) inputEvents.shift();
    }, true);
    window.SpaceManArena = { ...original, step(state, commands) {
      const human = state.actors.find(a => a.controller === 'human');
      window.lastHumanCommand = { ...commands[human.id] };
      window.humanEdges ||= { jump: 0, attack: 0, dash: 0 };
      for (const action of ['jump', 'attack', 'dash']) if (lastHumanCommand[action + 'Pressed']) humanEdges[action]++;
      return original.step(state, commands);
    } };
  });
  await page.locator('#btnArena').tap(); await page.locator('.arena-launch').tap(); await playing(page);
  const cdp = await context.newCDPSession(page);
  let id = 0;
  async function tapControl(locator) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: ++id, x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: 1, radiusY: 1, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function dragStick(direction = -1, captureFails = false) {
    const zone = page.locator('.arena-stick-zone'); const box = await zone.boundingBox();
    if (captureFails) await zone.evaluate(n => { n.originalCapture = n.setPointerCapture; n.setPointerCapture = () => { throw new Error('capture unavailable'); }; });
    const p = { id: ++id, x: box.x + box.width * .5, y: box.y + box.height * .55 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    p.x += direction * 38;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await page.waitForFunction(d => window.lastHumanCommand?.moveX * d > .5, direction);
    return p;
  }
  async function neutral() {
    try {
      await page.waitForFunction(() => lastHumanCommand?.moveX === 0 && lastHumanCommand?.moveY === 0 && !lastHumanCommand?.jumpHeld, null, { timeout: 5000 });
    } catch (error) {
      t.diagnostic(JSON.stringify(await page.evaluate(() => ({ screen: arenaUI.screen, phase: arenaUI.snapshot()?.phase, command: lastHumanCommand, events: window.inputEvents, pending: __arenaRafPending }))));
      throw error;
    }
    assert.equal(await page.locator('.arena-stick-active,.arena-pressed').count(), 0);
  }
  let p = await dragStick();
  const jump = await page.locator('.arena-touch-jump').boundingBox(), q = { id: ++id, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p, q] });
  await page.waitForFunction(() => lastHumanCommand?.jumpHeld);
  // CDP touchEnd ends the whole gesture and requires an empty touchPoints
  // list. Per-pointer ownership is covered by the cross-engine test below.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await neutral();

  // Complete a quick down/up in one task, before a simulation tick can sample
  // it. End-of-touch recovery must preserve its one-shot jump command.
  const jumpEdges = await page.evaluate(() => humanEdges.jump);
  await page.locator('.arena-touch-jump').evaluate(n => {
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 999, isPrimary: true }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 999, isPrimary: true }));
    n.dispatchEvent(Object.assign(new Event('touchend', { bubbles: true }), { touches: [] }));
  });
  await page.waitForFunction(before => humanEdges.jump > before, jumpEdges);
  await neutral();
  await page.keyboard.down('d');
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('touchcancel'), { touches: [] })));
  await page.waitForFunction(() => lastHumanCommand.moveX === 1);
  await page.keyboard.up('d'); await neutral();

  p = await dragStick(-1, true);
  p.x = 380; p.y = 180; // Outside the joystick, with failed capture.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await neutral();
  await page.locator('.arena-stick-zone').evaluate(n => { n.setPointerCapture = n.originalCapture; });

  await page.locator('.arena-stick-zone').evaluate(n => n.addEventListener('pointerdown', e => { n.lastPointer = e.pointerId; }));
  p = await dragStick(1);
  await page.locator('.arena-stick-zone').evaluate(n => n.releasePointerCapture(n.lastPointer));
  p.x += 2; // A changed native point processes pending capture loss.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await neutral();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  p = await dragStick();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await neutral();

  p = await dragStick();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await neutral(); assert.equal(await page.evaluate(() => arenaUI.screen), 'play', 'visible touch browser blur is not proof of leaving');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  p = await dragStick(); await page.setViewportSize({ width: 640, height: 390 }); await neutral();
  // Rotation invalidates portrait coordinates; cancel that old native gesture.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });

  p = await dragStick(); await pause(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tapControl(page.locator('#arenaResume')); await neutral();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await screen(page, 'pause');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await tapControl(page.locator('#arenaResume')); await neutral();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await screen(page, 'pause');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => arenaUI.screen), 'pause', 'returning from real background requires resume');
  await tapControl(page.locator('#arenaResume')); await neutral();
  p = await dragStick(); await pause(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tapControl(page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }));
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => input.left || input.right || input.jumpHeld), false);
  await tapControl(page.locator('#btnArena')); await tapControl(page.locator('.arena-launch')); await playing(page); await neutral();
});

test('arena mobile pointer lifecycle preserves taps and releases stranded holds', { timeout: 45000 }, async t => {
  const { page } = await launch(t, { viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  await page.evaluate(() => {
    const original = SpaceManArena;
    window.SpaceManArena = { ...original, step(state, commands) {
      window.sampledHuman = { ...commands[1] };
      if (sampledHuman.jumpPressed) window.sampledJumps = (window.sampledJumps || 0) + 1;
      return original.step(state, commands);
    } };
  });
  await page.locator('#btnArena').tap(); await page.locator('.arena-launch').tap(); await playing(page);
  // These synthetic DOM sequences cover the fallback when native pointer
  // capture is unavailable. Chromium's separate CDP test supplies native drags.
  async function stranded(id, primary = true) {
    await page.locator('.arena-stick-zone').evaluate((n, args) => {
      const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: args.id, isPrimary: args.primary, clientX: x, clientY: y }));
      n.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: args.id, clientX: x - 35, clientY: y }));
    }, { id, primary });
    await page.waitForFunction(() => sampledHuman?.moveX < -.5);
  }
  async function stopped() { await page.waitForFunction(() => sampledHuman?.moveX === 0); }
  await stranded(39);
  await page.locator('.arena-touch-jump').evaluate(n => n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 40, isPrimary: false })));
  await page.waitForFunction(() => sampledHuman.jumpHeld && sampledHuman.moveX < -.5);
  await page.locator('.arena-touch-jump').evaluate(n => n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 40 })));
  await page.waitForFunction(() => !sampledHuman.jumpHeld && sampledHuman.moveX < -.5);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 39 })));
  await stopped();
  await stranded(41);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 41 })));
  await stopped();
  await stranded(42);
  await page.evaluate(() => document.body.dispatchEvent(Object.assign(new Event('touchend', { bubbles: true }), { touches: [] })));
  await stopped();
  await stranded(43);
  // A fresh primary sequence proves all previous fingers ended, even if the
  // browser omitted the prior terminal event. Its new neutral origin replaces it.
  await page.locator('.arena-stick-zone').evaluate(n => {
    const r = n.getBoundingClientRect();
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 44, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await stopped();
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('touchcancel'), { touches: [] })));
  const before = await page.evaluate(() => window.sampledJumps || 0);
  await page.locator('.arena-touch-jump').evaluate(n => {
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 45, isPrimary: true }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 45, isPrimary: true }));
    n.dispatchEvent(Object.assign(new Event('touchend', { bubbles: true }), { touches: [] }));
  });
  await page.waitForFunction(count => sampledJumps > count, before);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(() => arenaUI.screen), 'play');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await screen(page, 'pause');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.locator('#arenaResume').tap(); await stopped();
});

test('arena desktop focus loss still pauses after pen input', { timeout: 30000 }, async t => {
  const { page } = await launch(t);
  await page.locator('#btnArena').click(); await page.locator('.arena-launch').click(); await playing(page);
  await page.locator('.arena-touch-jump').evaluate(n => {
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen', pointerId: 71, isPrimary: true }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'pen', pointerId: 71, isPrimary: true }));
  });
  assert.equal(await page.locator('.arena-root').getAttribute('data-touch'), 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await screen(page, 'pause');
});

test('arena native touch can resume immediately after a held gesture is paused', { timeout: 30000 }, async t => {
  const { page, context } = await launch(t, { viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  await page.locator('#btnArena').tap(); await page.locator('.arena-launch').tap(); await playing(page);
  await pause(page);
  await page.locator('#arenaResume').evaluate(n => {
    const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 91, clientX: x, clientY: y }));
    n.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 91, clientX: x + 20, clientY: y }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 91, clientX: x + 20, clientY: y }));
  });
  assert.equal(await page.evaluate(() => arenaUI.screen), 'pause', 'a scrolling gesture is not a Resume tap');
  await page.locator('#arenaResume').evaluate(n => {
    const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 92, clientX: x, clientY: y }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: false, pointerId: 93, clientX: x, clientY: y }));
    n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 92, clientX: x, clientY: y }));
  });
  await screen(page, 'match');
  await pause(page);
  await page.locator('#arenaResume').tap(); await screen(page, 'match');
  const cdp = await context.newCDPSession(page), box = await page.locator('.arena-stick-zone').boundingBox();
  const p = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  p.x -= 35; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  await pause(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('#arenaResume').tap(); await screen(page, 'match');
  assert.equal(await page.locator('.arena-stick-active,.arena-pressed').count(), 0);
});
