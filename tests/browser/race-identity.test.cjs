// Full race UI with genuine seat adapters and encrypted simulated-relay traffic.
// UI identity is checked separately from outfit color and shared actor ordering.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const { chromium, webkit } = require('playwright');
const { simulatedRelay } = require('./arena-network-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const engine = process.env.SPACE_MAN_RACE_BROWSER === 'webkit' ? webkit : chromium;

async function launch(t) {
  let server, base = process.env.SPACE_MAN_BASE_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
        res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
        res.end(await fs.readFile(file));
      } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  let browser;
  const hub = require('../harness.cjs').relay(), peers = [];
  t.after(async () => {
    for (const peer of peers) await peer.page.evaluate(() => SpaceManNet.leave()).catch(() => {});
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    for (const peer of peers) assert.deepEqual(peer.errors, [], peer.name + ' has no browser errors');
  });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  async function peer(name, width = 1280, height = 800, online = false) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, serviceWorkers: 'block' });
    const p = { name, context, errors: [], sockets: 0, unexpectedSockets: 0, deliveryErrors: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0, sentTypes: {}, receivedTypes: {}, offline: false };
    if (online) await simulatedRelay(context, p, hub);
    await context.addInitScript(() => {
      const p = /^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname);
      const prefix = p ? `sm2.preview.${p[1]}.${p[2]}.${p[3]}.` : '';
      localStorage.setItem(prefix + 'sm2.settings', JSON.stringify({ netRelay: 'relay.test', music: false, sfx: false, muted: true, haptics: false, reduceMotion: true }));
      window.identityLabels = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...rest) {
        if (this.canvas.classList.contains('race-canvas')) { identityLabels.push(String(text)); if (identityLabels.length > 100) identityLabels.shift(); }
        return fillText.call(this, text, ...rest);
      };
    });
    p.page = await context.newPage(); peers.push(p);
    p.page.on('pageerror', e => p.errors.push(e.message));
    p.page.on('dialog', d => d.accept());
    await p.page.goto(base);
    await p.page.locator('#btnRace').click();
    return p;
  }
  return { peer };
}
async function identity(page, role, id) {
  await page.waitForFunction(({ role, id }) => {
    const node = document.querySelector('.race-identity');
    return node?.dataset.role === role && node.dataset.actorId === id;
  }, { role, id });
  const name = await page.evaluate(id => raceUI.snapshot().actors.find(a => a.id === id).name, id);
  assert.equal(await page.locator('.race-identity-name').textContent(), name);
  assert.equal(await page.locator('.race-identity-role').textContent(), role === 'you' ? 'YOU' : 'WATCHING');
}
async function camera(page, mode) {
  for (let i = 0; i < 3 && await page.locator('.race-root').getAttribute('data-camera') !== mode; i++) await page.keyboard.press('c');
  await page.waitForFunction(mode => {
    const root = document.querySelector('.race-root');
    return root.dataset.camera === mode && root.dataset.renderer === (mode === 'topdown' ? '2d' : 'webgl');
  }, mode);
}
async function capture(page, name) {
  const dir = process.env.SPACE_MAN_RACE_IDENTITY_SCREENSHOTS;
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png') });
}

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 800]]) {
  test(`local pilot identity across all cameras at ${width}x${height}`, { timeout: 45000 }, async t => {
    const { peer } = await launch(t), { page } = await peer('local', width, height);
    await page.locator('.race-launch').click();
    await page.waitForFunction(() => raceUI.snapshot()?.phase === 'racing');
    const id = await page.evaluate(() => raceUI.snapshot().actors.find(a => a.controller === 'human').id);
    await identity(page, 'you', id);
    for (const mode of ['chase', 'cockpit', 'topdown', 'chase']) {
      await camera(page, mode);
      await identity(page, 'you', id);
      const hud = await page.locator('.race-identity').boundingBox();
      assert.ok(hud.width <= 190 && hud.x >= 0 && hud.x + hud.width <= width, 'compact identity stays in the viewport');
      const right = await page.locator('.race-hud-right').boundingBox();
      assert.ok(hud.x + hud.width <= right.x || hud.y >= right.y + right.height, 'identity does not cover pause or timer');
      assert.equal(await page.locator('.race-pilot-marker').isVisible(), mode === 'chase');
      if (mode === 'chase') {
        assert.equal(await page.locator('.race-pilot-marker').getAttribute('data-role'), 'you');
        assert.equal(await page.locator('.race-pilot-marker').evaluate(e => e.tagName), 'CANVAS');
        assert.equal(await page.locator('.race-pilot-marker').getAttribute('data-actor-id'), id);
      } else if (mode === 'topdown') {
        await page.waitForFunction(() => document.querySelector('.race-root').dataset.identity?.startsWith('YOU:'));
      }
      await capture(page, `race-identity-${width}-${mode}`);
    }
  });
}

test('non-first-seat pilot and spectator keep distinct identity through watch cycling', { timeout: 90000 }, async t => {
  const { peer } = await launch(t);
  const host = await peer('host', 1280, 800, true), friend = await peer('friend', 390, 844, true), watcher = await peer('watcher', 320, 568, true);
  await host.page.locator('summary').filter({ hasText: 'Play with friends' }).click();
  await host.page.locator('#raceHost').click();
  await host.page.waitForFunction(() => raceUI.roomStatus()?.active);
  const invite = await host.page.evaluate(() => SpaceManNet.info().link);
  for (const [p, watch] of [[friend, false], [watcher, true]]) {
    await p.page.locator('summary').filter({ hasText: 'Play with friends' }).click();
    await p.page.locator('#raceRoomInput').fill(invite);
    await p.page.locator(watch ? '#raceWatch' : '#raceJoin').click();
    await p.page.waitForFunction(() => raceUI.roomStatus()?.active && SpaceManNet.roster().some(r => r.you));
  }
  await host.page.waitForFunction(() => SpaceManNet.roster().length === 3);
  await host.page.locator('.race-launch').click();
  await Promise.all([host, friend, watcher].map(p => p.page.waitForFunction(() => raceUI.snapshot()?.phase === 'racing')));
  const friendId = await friend.page.evaluate(() => raceUI.snapshot().actors.find(a => a.controller === 'human').id);
  assert.notEqual(friendId, 'pilot-0', 'friend owns a non-first actor slot');
  await identity(friend.page, 'you', friendId);
  assert.equal(await friend.page.locator('.race-pilot-marker').getAttribute('data-actor-id'), friendId);
  for (const mode of ['chase', 'cockpit', 'topdown']) {
    await camera(watcher.page, mode);
    for (let i = 0; i < 3; i++) {
      await watcher.page.locator('#raceWatchNext').click();
      await watcher.page.waitForFunction(() => {
        const name = document.querySelector('.race-identity-name').textContent;
        return document.querySelector('#raceWatchName').textContent === 'WATCHING ' + name;
      });
      const id = await watcher.page.locator('.race-identity').getAttribute('data-actor-id');
      await identity(watcher.page, 'watching', id);
      assert.equal(await watcher.page.locator('.race-pilot-marker').isVisible(), mode === 'chase');
      if (mode === 'chase') {
        assert.equal(await watcher.page.locator('.race-pilot-marker').getAttribute('data-role'), 'watching');
        assert.equal(await watcher.page.locator('.race-pilot-marker').getAttribute('data-actor-id'), id);
      }
      if (mode === 'topdown') await watcher.page.waitForFunction(() => document.querySelector('.race-root').dataset.identity?.startsWith('WATCHING:'));
    }
    await capture(watcher.page, 'race-watching-' + mode);
  }
});
