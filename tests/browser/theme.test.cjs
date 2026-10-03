// Shared chrome, real lazy modes. No online service and no simulated gameplay results.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_THEME_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_THEME_SCREENSHOTS;
async function launch(t, root = ROOT, device = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + path.sep)) return res.writeHead(400).end();
      const bytes = await fs.readFile(file);
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] || 'text/plain';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(r => server.close(r));
  });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', reducedMotion: 'reduce', ...device });
  const page = await context.newPage(), errors = [], sockets = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', w => sockets.push(w.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#btnPlay').waitFor();
  await page.evaluate(() => { settings.muted = true; });
  t.after(() => { assert.deepEqual(errors, [], 'no page errors'); assert.deepEqual(sockets, [], 'no external room connections'); });
  return page;
}
async function capture(page, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${engineName}-${name}.png`) });
}
async function fit(page, selectors) {
  const problems = await page.evaluate(selectors => selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).filter(n => n.getClientRects().length).flatMap(n => {
    const b = n.getBoundingClientRect();
    return n.scrollWidth > n.clientWidth + 1 || b.x < -1 || b.right > innerWidth + 1 ? [{ selector, width: n.clientWidth, scroll: n.scrollWidth, x: b.x, right: b.right }] : [];
  })), selectors);
  assert.deepEqual(problems, [], 'zero horizontal overflow, including clipped content');
}
async function reachable(page, selector, minimum = 44) {
  const node = page.locator(selector);
  await node.scrollIntoViewIfNeeded();
  const b = await node.boundingBox(), viewport = page.viewportSize();
  assert.ok(b && b.height >= minimum - .5, `${selector} has a ${minimum}px target`);
  assert.ok(b.x >= -1 && b.x + b.width <= viewport.width + 1 && b.y >= -1 && b.y + b.height <= viewport.height + 1, `${selector} stays reachable`);
}
const sizes = [[320,568],[360,640],[375,667],[390,640],[390,844],[844,390],[768,1024],[1440,900]];
test('before screenshots retain the real production reference', { timeout: 90000, skip: !process.env.SPACE_MAN_THEME_BASE_ROOT }, async t => {
  const page = await launch(t, path.resolve(process.env.SPACE_MAN_THEME_BASE_ROOT));
  for (const [width,height] of [[320,568],[360,640],[375,667],[390,640],[390,844],[844,390],[768,1024],[1440,900]]) {
    await page.setViewportSize({ width, height });
    await capture(page, `before-${width}x${height}-title`);
    await page.locator('#btnArena').click(); await page.locator('.arena-root[data-screen=lobby]').waitFor();
    await capture(page, `before-${width}x${height}-arena`);
    await page.locator('#arenaBack').click();
    await page.locator('#btnRace').click(); await page.locator('.race-root[data-screen=lobby]').waitFor();
    await capture(page, `before-${width}x${height}-race`);
    await page.locator('.race-lobby-header button').click();
  }
});
for (const [width,height] of sizes) test(`shared chrome ${width}x${height}: launcher, modes, settings and interrupted return`, { timeout: 60000 }, async t => {
  const page = await launch(t, ROOT, { viewport: { width,height }, hasTouch: width < 900, isMobile: width < 900 });
  assert.equal(await page.locator('.launch-modes').getAttribute('aria-label'), 'Game modes');
  for (const selector of ['#btnPlay','#btnArena','#btnRace','#btnSettings','#btnDaily']) await reachable(page, selector);
  await fit(page, ['#ovAttract .panel','.launch-modes','.mode-link','#attractRow']);
  await page.locator('#ovAttract .panel').evaluate(n => { n.scrollTop = 0; });
  await capture(page, `after-${width}x${height}-title`);
  await page.locator('#btnArena').click(); await page.locator('.arena-root[data-screen=lobby]').waitFor();
  await fit(page, ['.arena-dialog','.arena-setup','.arena-formats','.arena-stage-cards','.arena-segmented']);
  await capture(page, `after-${width}x${height}-arena`);
  await reachable(page, '#arenaBack');
  await page.locator('.arena-launch').click(); await page.locator('.arena-root[data-screen=match]').waitFor();
  await capture(page, `after-${width}x${height}-arena-match`);
  await page.getByRole('button', { name: 'Pause match', exact: true }).click();
  await page.locator('.arena-root[data-screen=pause]').waitFor();
  await reachable(page, '#arenaResume');
  await page.getByRole('button', { name: 'Resume match', exact: true }).click();
  await page.getByRole('button', { name: 'Pause match', exact: true }).click();
  await page.getByRole('button', { name: 'All games', exact: true }).filter({ visible: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnArena');
  await page.locator('#btnRace').click(); await page.locator('.race-root[data-screen=lobby]').waitFor();
  await fit(page, ['.race-dialog','.race-setup','.race-track-list','.race-track','.race-options','.race-utilities','.race-preferences']);
  const launchBox = await page.locator('.race-launch').boundingBox();
  if ((width === 390 && height === 844) || (width >= 768 && height >= 800)) {
    assert.ok(launchBox.y >= 0 && launchBox.y + launchBox.height <= height, 'launch is visible on the first setup screen');
  }
  assert.equal(await page.locator('.race-preferences .race-camera-options').count(), 1, 'camera choices belong to the labelled preferences panel');
  assert.equal(await page.locator('.race-preferences .race-audio-controls').count(), 1, 'audio shares the same preferences panel');
  await page.locator('.race-online-panel > summary').click();
  await reachable(page, '#raceRoomInput');
  assert.ok(Number(await page.locator('#raceRoomInput').evaluate(n => parseFloat(getComputedStyle(n).fontSize))) >= 16, 'room input avoids iPhone focus zoom');
  await reachable(page, '#raceJoin');
  await page.locator('.race-online-panel > summary').click();
  await page.locator('.race-lobby').evaluate(n => { n.scrollTop = 0; });
  await capture(page, `after-${width}x${height}-race`);
  await page.locator('.race-launch').click(); await page.locator('.race-root[data-screen=play]').waitFor();
  await capture(page, `after-${width}x${height}-race-driving`);
  if (width < 900) {
    const rescue = await page.locator('.race-recover').boundingBox();
    for (const side of ['.race-steering','.race-actions']) {
      const group = await page.locator(side).boundingBox();
      assert.ok(rescue.x + rescue.width <= group.x + 1 || group.x + group.width <= rescue.x + 1 || rescue.y + rescue.height <= group.y + 1 || group.y + group.height <= rescue.y + 1, 'rescue does not obstruct held touch controls');
    }
  }
  await page.getByRole('button', { name: 'Pause race', exact: true }).click();
  await page.locator('.race-root[data-screen=pause]').waitFor();
  await reachable(page, '.race-compact:visible .race-primary');
  await capture(page, `after-${width}x${height}-race-pause`);
  await reachable(page, '#raceExit');
  await page.getByRole('slider', { name: 'Race audio volume' }).filter({ visible: true }).scrollIntoViewIfNeeded();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Pause race', exact: true }).click();
  assert.equal(await page.locator('.race-compact:visible').evaluate(n => n.scrollTop), 0, 'reopened pause resets its old scroll position');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'raceResume', 'resume remains the first action');
  await page.getByRole('button', { name: 'All games', exact: true }).filter({ visible: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnRace');
  await page.locator('#btnSettings').click();
  await page.locator('#ovSettings.show').waitFor();
  await fit(page, ['#ovSettings .panel','#ovSettings .settings-list','#ovSettings .toggle-row']);
  await reachable(page, '#btnCloseSettings');
  await page.locator('#ovSettings .panel').evaluate(n => { n.scrollTop = 0; });
  await capture(page, `after-${width}x${height}-settings`);
  await page.locator('#btnCloseSettings').click();
  await page.locator('#btnPlay').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => G.mode === 'play');
  await page.keyboard.press('Escape'); await page.locator('#ovPause.show').waitFor();
  await reachable(page, '#btnResume');
  await page.locator('#btnResume').click(); await page.waitForFunction(() => G.mode === 'play');
  await page.keyboard.press('Escape'); await page.locator('#btnQuit').click();
  await page.locator('#ovAttract.show').waitFor();
  await fit(page, ['#ovAttract .panel','.mode-link']);
});
test('keyboard and controller focus are visible, settings survive reload', { timeout: 30000 }, async t => {
  const page = await launch(t);
  await page.locator('#btnArena').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnRace');
  assert.equal(await page.locator('#btnRace').evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
  await page.evaluate(() => document.body.classList.add('gamepad-active'));
  await page.locator('#btnPlay').focus();
  assert.equal(await page.locator('#btnPlay').evaluate(n => getComputedStyle(n).outlineColor), 'rgb(255, 229, 154)');
  await page.locator('#btnSettings').click();
  const motion = page.locator('#ovSettings [data-setting=reduceMotion]');
  assert.equal(await motion.getAttribute('aria-checked'), 'true', 'OS reduced motion is the initial default');
  await motion.click();
  assert.equal(await page.locator('#btnCloseSettings').evaluate(n => getComputedStyle(n).transitionDuration.split(',').some(v => parseFloat(v) > 0)), true, 'explicit OFF restores button transitions');
  await motion.click();
  assert.equal(await page.locator('#btnCloseSettings').evaluate(n => getComputedStyle(n).transitionDuration), '0s', 'explicit ON disables transitions');
  // Settings UI builds from the shared schema; exercise an actual switch.
  const switches = page.locator('#ovSettings button[role=switch]');
  const first = switches.first();
  const before = await first.getAttribute('aria-checked');
  await first.click();
  const after = await first.getAttribute('aria-checked');
  assert.notEqual(after, before);
  await page.reload(); await page.locator('#btnSettings').click();
  assert.equal(await page.locator('#ovSettings button[role=switch]').first().getAttribute('aria-checked'), after);
});

test('runner result card fixture shares chrome without clipping retry or score', { timeout: 30000 }, async t => {
  const page = await launch(t);
  // The shipped deterministic screenshot route stages a run-over card. This
  // checks its layout only; real gameplay/results remain covered elsewhere.
  const base = page.url();
  await page.goto(base + '?theme-layout=results#shot=dead&seed=42&frames=600');
  await page.locator('#ovDead.show').waitFor();
  for (const [width,height] of [[320,568],[390,640],[390,844],[844,390],[1440,900]]) {
    await page.setViewportSize({ width,height });
    await reachable(page, '#btnAgain');
    // The retry dock intentionally bleeds through the panel's horizontal
    // padding; measure its actual panel boundary, not the inner column width.
    await fit(page, ['#ovDead .panel','#deadStats','.dead-main']);
    const dock = await page.locator('#ovDead .dock').boundingBox();
    const panel = await page.locator('#ovDead .panel').boundingBox();
    assert.ok(dock.x >= panel.x - 1 && dock.x + dock.width <= panel.x + panel.width + 1, 'retry dock stays inside the panel');
    await capture(page, `after-${width}x${height}-runner-results-fixture`);
  }
});
