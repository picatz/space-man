'use strict';
// Secondary-screen acceptance against the shipped UI. Only initial saved
// profiles and the standard gamepad-device boundary are fixtures. Runner
// results come from real movement/death; room tests replace only the opaque
// relay hop. No result teleport, production storage, live relay, or Reset accept.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_SECONDARY_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName), 'SPACE_MAN_SECONDARY_BROWSER must be chromium or webkit');
const engine = engineName === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_SECONDARY_SCREENSHOTS;
const SIZES = [[320, 568], [390, 844], [844, 390], [820, 1180], [1440, 900]];
const GROUPS = ['Sound', 'Feel', 'Motion & controls', 'Performance', 'Keyboard', 'Run Together', 'Connection'];
const TOP5 = [
  { initials: 'ORB', score: 98765, dist: 1782, chain: 8 },
  { initials: 'NVA', score: 12500, dist: 1420, chain: 4 },
  { initials: 'ACE', score: 8700, dist: 980, chain: 4 },
  { initials: 'SOL', score: 3500, dist: 670, chain: 2 },
  { initials: 'JET', score: 1250, dist: 340, chain: 2 },
];

async function launch(t, viewport = { width: 1440, height: 900 }, options = {}) {
  let server, browser, relayClient;
  const errors = [], sockets = [], externalRequests = [];
  t.after(async () => {
    // Destroy the throwaway browser profile, including fixture-only saves.
    if (relayClient) for (const socket of relayClient.bridgeSockets.values()) socket.close();
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.deepEqual(sockets, [], 'no native/public WebSocket attempts');
    assert.deepEqual(externalRequests, [], 'no external HTTP requests');
    if (relayClient) assert.equal(relayClient.unexpectedSockets, 0, 'simulated relay accepts only relay.test');
  });
  let base = process.env.SPACE_MAN_BASE_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
      } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  const target = new URL(base);
  assert.ok(/^https?:$/.test(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    'SPACE_MAN_BASE_URL is an HTTP(S) directory URL without credentials, query or fragment');
  if (!target.pathname.endsWith('/')) target.pathname += '/';
  if (options.course) target.hash = 'seed=77&beat=500&v=2';
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const touch = options.touch ?? viewport.width < 1000;
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US' });
  await context.routeWebSocket('**/*', ws => { sockets.push(ws.url()); ws.close(); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === target.origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  if (options.relay) {
    const { simulatedRelay } = require('./arena-network-helper.cjs');
    relayClient = { sockets: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0,
      unexpectedSockets: 0, deliveryErrors: 0, sentTypes: {}, receivedTypes: {}, offline: false };
    await simulatedRelay(context, relayClient, options.hub || require('../harness.cjs').relay());
  }
  // A new context owns an empty, isolated localStorage. Seed once so reload
  // assertions inspect what UI handlers really persisted, never a re-seeded copy.
  await context.addInitScript(({ populated, callsign, top5, relay, controller }) => {
    const preview = /^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname);
    const prefix = preview ? `sm2.preview.${preview[1]}.${preview[2]}.${preview[3]}.` : '';
    const key = name => prefix + name;
    if (!localStorage.getItem(key('secondary-test.seeded'))) {
      const put = (name, value) => localStorage.setItem(key(name), JSON.stringify(value));
      put('sm2.settings', { music: true, sfx: true, muted: true, musicVol: 0.6, sfxVol: 0.7,
        haptics: false, shake: false, reduceMotion: true, autorun: false, lefty: false,
        ...(relay ? { netRelay: 'https://relay.test' } : {}) });
      put('sm2.autorunReset', 1);
      put('sm2.top5', populated ? top5 : []);
      put('sm2.best', populated ? top5[0].score : 0);
      put('sm2.stats', populated ? { runs: 27, kills: 148, bestDist: 1782, bestScore: top5[0].score,
        bestChain: 8, medals: { BRONZE: 5, SILVER: 2, GOLD: 1, PLATINUM: 0 } } : {});
      put('sm2.discoveries', populated ? ['wave', 'moon', 'mars'] : []);
      put('sm2.flags', { initials: 'ORB', installDismissed: true });
      put('sm2.cosmetics', callsign ? { callsign: [3, 1] } : {});
      put('secondary-test.seeded', true);
    }
    if (controller) {
      window.secondaryTestPad = { connected: true, mapping: 'standard', index: 0,
        id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
        axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [secondaryTestPad] });
    }
  }, { populated: options.populated !== false, callsign: options.callsign !== false, top5: TOP5,
    relay: !!options.relay, controller: !!options.controller });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(target.href);
  await home(page);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.SPACE_MAN_EXPECTED_SHA) assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha, process.env.SPACE_MAN_EXPECTED_SHA);
  return { page, context, relayClient, touch };
}
async function home(page) {
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
}
async function panel(page, id) {
  await page.locator(`#${id}.in`).waitFor();
  const content = page.locator(`#${id} .panel`);
  if (await content.evaluate(n => n.classList.contains('secondary-panel'))) {
    assert.equal(await content.getAttribute('aria-modal'), 'true');
    const focus = await content.evaluate(n => {
      const active = document.activeElement, r = active?.getBoundingClientRect();
      return { inside: n.contains(active), hidden: !!active?.closest('[aria-hidden="true"]'),
        visible: !!r && r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1,
        active: active?.id || active?.tagName };
    });
    assert.ok(focus.inside && !focus.hidden && focus.visible, `${id}: opening puts focus on a visible dialog control ${JSON.stringify(focus)}`);
  }
  return content;
}
async function activate(page, selector) {
  const node = page.locator(selector);
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await node.tap(); else await node.click();
}
async function capture(page, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(SHOTS, `${engineName}-secondary-${name}.png`) });
}
async function fit(page, id) {
  const problems = await page.locator('#' + id).evaluate(root => {
    const nodes = [root.querySelector('.panel'), ...root.querySelectorAll('.settings-list, .settings-group, table.scores, #logbook, .callsign-cols, .stat-grid, .room-top, .room-invite, .join-input')];
    return nodes.filter(n => n && n.getClientRects().length).flatMap(n => {
      const r = n.getBoundingClientRect();
      return n.scrollWidth > n.clientWidth + 1 || r.left < -1 || r.right > innerWidth + 1
        ? [{ id: n.id, class: n.className, width: n.clientWidth, scrollWidth: n.scrollWidth, left: r.left, right: r.right }] : [];
    });
  });
  assert.deepEqual(problems, [], `${id}: no horizontal overflow or clipped columns`);
  const bounds = await page.locator(`#${id} .panel`).boundingBox();
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= page.viewportSize().height + 1, `${id}: panel fits inside viewport`);
}
async function targets(page, id) {
  const problems = await page.locator('#' + id).evaluate(root => Array.from(root.querySelectorAll('button, input, textarea, summary, [role="button"][tabindex]'))
    .filter(n => n.getClientRects().length && !n.closest('[aria-hidden="true"]') && !n.disabled && getComputedStyle(n).visibility !== 'hidden')
    .flatMap(n => { const r = n.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5
      ? [{ id: n.id, label: n.getAttribute('aria-label') || n.textContent.trim(), type: n.type, width: r.width, height: r.height }] : []; }));
  assert.deepEqual(problems, [], `${id}: every visible interactive target is at least 44px`);
  await modalWrap(page, id);
}
async function modalWrap(page, id) {
  const controls = page.locator(`#${id} .secondary-panel`).locator(':is(button, input, textarea, summary, [role="button"][tabindex]):visible:not([disabled]):not([tabindex="-1"])');
  assert.ok(await controls.count(), `${id}: modal has usable keyboard controls`);
  const first = controls.first(), last = controls.last();
  const previous = await page.evaluateHandle(() => document.activeElement);
  const scroll = await page.locator(`#${id} .panel`).evaluate(n => n.scrollTop);
  await last.focus(); await page.keyboard.press('Tab');
  assert.equal(await first.evaluate(n => {
    const style = getComputedStyle(n);
    return document.activeElement === n && (n.matches(':focus-visible') || document.body.classList.contains('keyboard-active'))
      && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2;
  }), true, `${id}: forward Tab wraps to the first real control`);
  await first.focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await last.evaluate(n => {
    const style = getComputedStyle(n);
    return document.activeElement === n && (n.matches(':focus-visible') || document.body.classList.contains('keyboard-active'))
      && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2;
  }), true, `${id}: backward Tab wraps to the last real control`);
  await previous.evaluate(n => n.focus()); await previous.dispose();
  await page.locator(`#${id} .panel`).evaluate((n, top) => { n.scrollTop = top; }, scroll);
}
async function reachable(page, selector) {
  const node = page.locator(selector);
  // Ordinary scrolling, not a DOM/style rewrite. Centering avoids pretending a
  // control covered by the sticky footer is reachable just because it has a box.
  await node.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const state = await node.evaluate(n => {
    const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, hit: hit === n || n.contains(hit), enabled: !n.disabled, w: innerWidth, h: innerHeight };
  });
  assert.ok(state.top >= -1 && state.bottom <= state.h + 1 && state.left >= -1 && state.right <= state.w + 1 && state.hit && state.enabled,
    `${selector}: fully visible and uncovered after scrolling ${JSON.stringify(state)}`);
}
async function scrollToRead(page, id) {
  const content = page.locator(`#${id} .panel`);
  await content.evaluate(n => { n.scrollTop = 0; });
  if (!await content.evaluate(n => n.scrollHeight > n.clientHeight + 1)) return;
  const bounds = await content.boundingBox();
  if (engineName === 'webkit' && await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    // Playwright has no mobile WebKit wheel/swipe input. Inspect the real scroll
    // container here; the next helper verifies actual native Tab scrolling.
    await content.evaluate(n => n.scrollBy(0, 500));
  } else {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(80, bounds.height / 3));
    await page.mouse.wheel(0, 500);
  }
  await page.waitForFunction(id => document.querySelector(`#${id} .panel`).scrollTop > 0, id);
  assert.equal(await page.evaluate(() => scrollY), 0, 'reading scrolls the panel, never the page behind it');
}
async function footerByKeyboard(page, id, footer) {
  const root = page.locator('#' + id), list = root.locator('button:visible:not([disabled]), input:visible:not([disabled]), textarea:visible:not([disabled]), summary:visible');
  const count = await list.count();
  await list.first().focus();
  // Make keyboard ownership real before inspecting :focus-visible.
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  for (let i = 0; i <= count + 2 && await page.evaluate(() => document.activeElement.id) !== footer; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), footer, `${id}: Tab reaches its footer`);
  const state = await page.locator('#' + footer).evaluate(n => {
    const r = n.getBoundingClientRect(), style = getComputedStyle(n), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { visible: r.top >= -1 && r.bottom <= innerHeight + 1 && (hit === n || n.contains(hit)), focus: n === document.activeElement && (n.matches(':focus-visible') || document.body.classList.contains('keyboard-active')), outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
  });
  assert.ok(state.visible && state.focus && state.outline === 'solid' && state.outlineWidth >= 2, `${id}: focused footer is visible ${JSON.stringify(state)}`);
  assert.equal(await page.evaluate(() => scrollY), 0, 'body stays locked; the panel owns scrolling');
}
async function keyboardClose(page, id, footer) {
  await footerByKeyboard(page, id, footer);
  await page.keyboard.press('Enter'); await home(page);
}
async function stored(page, name) {
  return page.evaluate(name => JSON.parse(localStorage.getItem(SpaceManBuild.storageKey('sm2.' + name))), name);
}
async function moveThenFinishRun(page) {
  await activate(page, '#btnPlay');
  await page.waitForFunction(() => G.mode === 'play' && !G.player.dead);
  await page.keyboard.down('ArrowRight');
  try { await page.waitForFunction(() => G.dist >= 12, undefined, { timeout: 7000 }); }
  finally { await page.keyboard.up('ArrowRight'); }
  // The ordinary approaching flare finishes this short run. No simulation
  // clock, actor, score, death function or outcome is changed by the test.
  await page.waitForFunction(() => G.mode === 'dead', undefined, { timeout: 25000 });
  await panel(page, 'ovDead');
  await page.waitForFunction(() => document.getElementById('deadScore').textContent === G.finalScore.toLocaleString());
  await page.waitForFunction(() => G.time - G.deadShownAt >= 1);
}

for (const [width, height] of SIZES) test(`secondary ${width}x${height}: records, settings, callsign, room entry, real results and retry`, { timeout: 100000 }, async t => {
  const { page } = await launch(t, { width, height }, { course: true });
  const size = `${width}x${height}`;
  await activate(page, '#btnTrophy'); await panel(page, 'ovTrophy');
  assert.equal(await page.locator('#trophyScores tr').count(), 5);
  assert.deepEqual(await page.locator('#trophyScores td:nth-child(2)').allTextContents(), TOP5.map(r => r.initials));
  assert.equal(await page.locator('#trophyScores tr').first().locator('.sc').innerText(), (98765).toLocaleString('en-US'));
  assert.match(await page.locator('#trophyStats').innerText(), /RUNS 27 · KILLS 148 · BEST DIST 1782m/);
  assert.match(await page.locator('#logCount').innerText(), /^3 \/ 10 FOUND$/);
  assert.equal(await page.locator('#logbook .log-row:not(.unfound)').count(), 3);
  assert.equal(await page.locator('#logbook').evaluate(n => getComputedStyle(n).overflowY), 'visible', 'logbook shares the full-panel scroll');
  await fit(page, 'ovTrophy'); await targets(page, 'ovTrophy');
  await capture(page, `records-populated-${size}-top`);
  await scrollToRead(page, 'ovTrophy');
  await reachable(page, '#logCount');
  await capture(page, `records-populated-${size}-logbook`);
  await keyboardClose(page, 'ovTrophy', 'btnCloseTrophy');

  await activate(page, '#btnSettings'); await panel(page, 'ovSettings');
  assert.deepEqual(await page.locator('#ovSettings .settings-group').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label'))), GROUPS);
  await fit(page, 'ovSettings'); await targets(page, 'ovSettings');
  await capture(page, `settings-${size}-top`);
  await scrollToRead(page, 'ovSettings');
  for (const selector of ['[data-setting="muted"]', '[data-setting="musicVol"]', '[data-setting="reduceMotion"]', '[data-setting="batterySaver"]', '[data-setting="netGhosts"]', '.net-radio-opt[data-mode="default"]', '#btnReset']) await reachable(page, `#ovSettings ${selector}`);
  await capture(page, `settings-${size}-connection`);
  await keyboardClose(page, 'ovSettings', 'btnCloseSettings');

  await activate(page, '#btnWardrobe'); await panel(page, 'ovWardrobe');
  const oldCallsign = (await stored(page, 'cosmetics')).callsign;
  await activate(page, '#wardCallsignRow'); await panel(page, 'ovCallsign');
  for (const label of ['Next adjective', 'Previous adjective', 'Next noun', 'Previous noun']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1);
  assert.equal(await page.locator('#btnCallsignDone').innerText(), 'Use callsign');
  await page.getByRole('button', { name: 'Next adjective', exact: true }).click();
  await fit(page, 'ovCallsign'); await targets(page, 'ovCallsign');
  await capture(page, `callsign-${size}`);
  await footerByKeyboard(page, 'ovCallsign', 'btnCallsignCancel'); await page.keyboard.press('Enter');
  await panel(page, 'ovWardrobe');
  assert.deepEqual((await stored(page, 'cosmetics')).callsign, oldCallsign, 'Cancel does not save a trial callsign');
  await activate(page, '#btnWardrobeDone'); await home(page);

  await activate(page, '#btnTogether'); await panel(page, 'ovTogether');
  await fit(page, 'ovTogether'); await targets(page, 'ovTogether');
  await capture(page, `together-${size}`);
  await page.locator('#joinInput').fill('this is not a room'); await page.locator('#joinInput').press('Enter');
  await page.waitForFunction(() => document.getElementById('joinHint').classList.contains('err'));
  assert.ok((await page.locator('#joinHint').innerText()).length > 12, 'invalid input gives useful visible feedback');
  assert.equal(await page.locator('#joinInput').inputValue(), 'this is not a room', 'invalid entry remains editable');
  await page.locator('#joinInput').fill('');
  assert.equal(await page.locator('#joinHint').evaluate(n => n.classList.contains('err')), false, 'editing clears stale error');
  await keyboardClose(page, 'ovTogether', 'btnTogetherBack');

  await moveThenFinishRun(page);
  const ended = await page.evaluate(() => ({ score: G.finalScore, dist: G.dist, seed: G.runSeed, runs: stats.runs }));
  assert.ok(ended.score > 0 && ended.dist >= 12, 'result came from an actual played run');
  assert.equal(ended.runs, 28, 'exactly one result is banked');
  assert.equal(await page.locator('#deadScore').innerText(), ended.score.toLocaleString('en-US'));
  assert.equal(await page.locator('#deadStats .stat').first().locator('b').innerText(), `${ended.dist | 0}m`);
  assert.equal(await page.locator('#deadScores tr').count(), 5);
  assert.equal(await page.locator('#btnShare').isVisible(), true);
  await fit(page, 'ovDead'); await targets(page, 'ovDead');
  await capture(page, `runner-results-${size}`);
  await reachable(page, '#btnAgain'); await activate(page, '#btnAgain');
  await page.waitForFunction(() => G.mode === 'play' && !G.player.dead);
  assert.equal(await page.evaluate(() => G.runSeed), ended.seed, 'Play Again replays the same challenge');
  assert.equal(await page.locator('#ovDead').isVisible(), false, 'old results dismiss');
  assert.equal(await page.evaluate(() => input.jumpHeld || input.fireKey || input.left || input.right), false, 'retry does not retain menu input');
  await page.keyboard.press('Escape'); await panel(page, 'ovPause');
  await activate(page, '#btnQuit'); await home(page);
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`secondary ${width}x${height}: empty records and cancelled Reset preserve isolated saves`, { timeout: 35000 }, async t => {
  const { page } = await launch(t, { width, height }, { populated: false });
  await activate(page, '#btnTrophy'); await panel(page, 'ovTrophy');
  assert.equal(await page.locator('#trophyScores tr').count(), 1);
  assert.equal(await page.locator('#trophyScores .empty').innerText(), 'Your first run starts the story.');
  assert.match(await page.locator('#trophyStats').innerText(), /RUNS 0 · KILLS 0 · BEST DIST 0m/);
  assert.equal(await page.locator('#logbook .log-row:not(.unfound)').count(), 0);
  await fit(page, 'ovTrophy'); await capture(page, `records-empty-${width}x${height}`);
  await keyboardClose(page, 'ovTrophy', 'btnCloseTrophy');
  await activate(page, '#btnSettings'); await panel(page, 'ovSettings');
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const request = page.waitForEvent('dialog');
  const click = page.locator('#btnReset').click();
  const dialog = await request;
  assert.equal(dialog.type(), 'confirm'); assert.match(dialog.message(), /cannot be undone/i);
  await dialog.dismiss(); await click;
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), before, 'cancel leaves every isolated save byte unchanged');
  assert.equal(await page.locator('#ovSettings.in').isVisible(), true, 'cancel does not navigate/reload');
  await keyboardClose(page, 'ovSettings', 'btnCloseSettings');
});

test('secondary Settings: switches, native range keys, rebinding and native connection controls persist', { timeout: 60000 }, async t => {
  const { page } = await launch(t);
  await activate(page, '#btnSettings'); await panel(page, 'ovSettings');
  const settingsPanel = page.locator('#ovSettings');
  for (const key of ['music', 'sfx', 'lefty', 'autorun', 'reduceMotion', 'batterySaver', 'netEmotes', 'netApprove']) {
    const control = settingsPanel.locator(`[data-setting="${key}"]`), old = await control.getAttribute('aria-checked');
    assert.equal(await control.evaluate(n => n.tagName), 'BUTTON');
    await control.focus(); await page.keyboard.press('Space');
    assert.equal(await control.getAttribute('aria-checked'), String(old !== 'true'), key + ' responds to a real keyboard activation');
  }
  const music = settingsPanel.getByRole('slider', { name: 'Music volume', exact: true });
  await music.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Tab');
  assert.equal(await music.inputValue(), '55');
  assert.equal(await music.evaluate(n => n.nextElementSibling.textContent), '55%');
  const ghosts = settingsPanel.getByRole('slider', { name: 'Ghost opacity', exact: true });
  await ghosts.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Tab');
  assert.equal(await ghosts.inputValue(), '25', 'range keyboard honors its nonzero lower bound');
  const bind = settingsPanel.locator('[data-key-bind="jump"]');
  await bind.click(); await page.keyboard.press('j');
  assert.equal(await bind.innerText(), 'J');
  await bind.click(); await page.keyboard.press('Escape');
  assert.equal(await bind.innerText(), 'J', 'Escape cancels only rebinding');
  assert.equal(await page.locator('#ovSettings.in').isVisible(), true);
  await bind.click(); await page.keyboard.press('r');
  assert.match(await bind.innerText(), /^press a key$/i, 'reserved key is rejected');
  await page.keyboard.press('Escape');
  for (const mode of ['custom', 'list', 'default', 'custom']) {
    const control = settingsPanel.locator(`.net-radio-opt[data-mode="${mode}"]`);
    assert.equal(await control.evaluate(n => n.tagName), 'BUTTON', 'connection choices use native buttons');
    await control.focus(); await page.keyboard.press('Space');
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.equal(await settingsPanel.locator('.net-radio-opt[aria-pressed="true"]').count(), 1);
    assert.equal(await settingsPanel.locator('.net-relayurl').isVisible(), mode === 'custom');
    assert.equal(await settingsPanel.locator('.net-relaylist').isVisible(), mode === 'list');
  }
  const url = settingsPanel.getByRole('textbox', { name: 'Custom relay directory URL', exact: true });
  await url.fill('https://relay.example.test/directory'); await url.press('Tab');
  await settingsPanel.locator('.net-radio-opt[data-mode="list"]').click();
  const servers = settingsPanel.getByRole('textbox', { name: 'Relay server list', exact: true });
  await servers.fill('relay-one.example.test\nrelay-two.example.test'); await servers.press('Tab');
  const blocked = settingsPanel.locator('button.settings-action').filter({ has: page.locator('.net-blocked-count') });
  assert.equal(await blocked.getAttribute('aria-expanded'), 'false');
  await blocked.focus(); await page.keyboard.press('Enter');
  assert.equal(await blocked.getAttribute('aria-expanded'), 'true');
  assert.equal(await settingsPanel.locator('.net-blocked-list').innerText(), 'No blocked players.');
  await page.keyboard.press('Space'); assert.equal(await blocked.getAttribute('aria-expanded'), 'false');
  const customRelay = settingsPanel.locator('button.settings-action').filter({ has: page.locator('.net-customrelay-val') });
  const prompt = page.waitForEvent('dialog'), click = customRelay.click();
  const dialog = await prompt; assert.equal(dialog.type(), 'prompt'); await dialog.dismiss(); await click;
  assert.equal(await settingsPanel.locator('.net-customrelay-val').innerText(), 'Off', 'cancel custom relay prompt preserves its value');
  await fit(page, 'ovSettings'); await targets(page, 'ovSettings');
  await capture(page, 'settings-edited-native-controls');
  const saved = await stored(page, 'settings');
  assert.equal(saved.musicVol, 0.55); assert.equal(saved.netGhosts, 0.25); assert.equal(saved.keys.jump, 'j');
  assert.equal(saved.netRelayMode, 'list'); assert.equal(saved.netRelayUrl, 'https://relay.example.test/directory');
  assert.equal(saved.netRelayList, 'relay-one.example.test\nrelay-two.example.test');
  await keyboardClose(page, 'ovSettings', 'btnCloseSettings');
  await page.reload(); await home(page); await activate(page, '#btnSettings'); await panel(page, 'ovSettings');
  for (const key of ['music', 'sfx', 'lefty', 'autorun', 'reduceMotion', 'batterySaver', 'netEmotes', 'netApprove']) assert.equal(await settingsPanel.locator(`[data-setting="${key}"]`).getAttribute('aria-checked'), String(saved[key]), key + ' survives reload');
  assert.equal(await music.inputValue(), '55'); assert.equal(await ghosts.inputValue(), '25'); assert.equal(await bind.innerText(), 'J');
  assert.equal(await servers.inputValue(), saved.netRelayList);
  assert.equal(await settingsPanel.locator('.net-radio-opt[data-mode="list"]').getAttribute('aria-pressed'), 'true');
  await settingsPanel.getByRole('button', { name: 'Reset keys to defaults', exact: true }).click();
  assert.deepEqual((await stored(page, 'settings')).keys, { left: 'a', right: 'd', jump: 'w', fire: 'f', down: 's', dash: 'shift', rescue: 'r', camera: 'c', pause: 'p', mute: 'm' }, 'key reset restores only the key map');
  assert.equal((await stored(page, 'settings')).musicVol, 0.55);
  await page.keyboard.press('Escape'); await home(page);
});

for (const controller of [false, true]) test(`secondary callsign: ${controller ? 'controller Back' : 'Escape'} cancels, commit and reopen retain identity`, { timeout: 40000 }, async t => {
  const { page, relayClient } = await launch(t, { width: 1440, height: 900 }, { callsign: false, controller });
  if (controller) await page.waitForFunction(() => input.pad.connected);
  await activate(page, '#btnTogether'); await panel(page, 'ovTogether');
  await activate(page, '#btnCreateRoom'); await panel(page, 'ovCallsign');
  await page.getByRole('button', { name: 'Next noun', exact: true }).click();
  if (controller) {
    await page.evaluate(() => { secondaryTestPad.buttons[1].pressed = true; });
    await panel(page, 'ovTogether');
    await page.evaluate(() => { secondaryTestPad.buttons[1].pressed = false; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } else { await page.keyboard.press('Escape'); await panel(page, 'ovTogether'); }
  assert.equal(await page.evaluate(() => hasCallsign()), false, 'dismissal never commits the automatically suggested name');
  assert.equal(await page.locator('#btnCreateRoom').isEnabled(), true, 'cancel restores an actionable room entry');
  assert.equal(await page.evaluate(() => SpaceManNet.active), false, 'cancel does not run the Create Room continuation');
  assert.equal(relayClient, undefined, 'this cancellation path has no relay fixture');
  await activate(page, '#btnTogetherBack'); await home(page);
  await activate(page, '#btnWardrobe'); await panel(page, 'ovWardrobe');
  await activate(page, '#wardCallsignRow'); await panel(page, 'ovCallsign');
  const initial = await page.locator('#callsignPreview').innerText();
  await page.getByRole('button', { name: 'Next adjective', exact: true }).click();
  assert.notEqual(await page.locator('#callsignPreview').innerText(), initial);
  await page.getByRole('button', { name: 'Previous adjective', exact: true }).click();
  assert.equal(await page.locator('#callsignPreview').innerText(), initial, 'both labeled arrow directions work');
  await activate(page, '#btnCallsignReroll');
  const chosen = await page.locator('#callsignPreview').innerText(); assert.ok(chosen.trim());
  await activate(page, '#btnCallsignDone'); await panel(page, 'ovWardrobe');
  assert.equal(await page.locator('#wardCallsignVal').innerText(), chosen);
  const saved = (await stored(page, 'cosmetics')).callsign;
  await activate(page, '#wardCallsignRow'); await panel(page, 'ovCallsign');
  assert.equal(await page.locator('#callsignPreview').innerText(), chosen, 'reopening starts from the saved pair');
  await page.getByRole('button', { name: 'Next noun', exact: true }).click();
  await activate(page, '#btnCallsignCancel'); await panel(page, 'ovWardrobe');
  assert.deepEqual((await stored(page, 'cosmetics')).callsign, saved);
  assert.equal(await page.locator('#wardCallsignVal').innerText(), chosen);
  await activate(page, '#btnWardrobeDone'); await home(page);
  await page.reload(); await home(page);
  assert.equal(await page.locator('#homeCallsign').innerText(), chosen, 'committed callsign survives reload');
});

for (const [width, height] of SIZES) test(`secondary room ${width}x${height}: real create/back/reopen with SIMULATED relay only`, { timeout: 55000 }, async t => {
  const { page, relayClient } = await launch(t, { width, height }, { relay: true });
  await activate(page, '#btnTogether'); await panel(page, 'ovTogether');
  assert.equal(relayClient.sockets, 0, 'front door remains local until Create');
  await activate(page, '#btnCreateRoom'); await panel(page, 'ovRoom');
  const state = await page.evaluate(() => ({ active: SpaceManNet.active, mock: SpaceManNet.mockActive, info: { players: SpaceManNet.info().players, isHost: SpaceManNet.info().isHost }, seed: SpaceManNet.info().seed }));
  assert.equal(state.active, true); assert.equal(state.mock, false);
  assert.equal(state.info.isHost, true); assert.equal(state.info.players, 1);
  assert.ok(relayClient.sockets > 0 && relayClient.sent > 0 && relayClient.received > 0, 'production room completes the relay handshake');
  assert.equal(await page.locator('#roomRoster .roster-row').count(), 1);
  assert.match(await page.locator('#roomRoster').innerText(), /you, host/i);
  assert.ok((await page.locator('#roomLink').innerText()).length > 10);
  await fit(page, 'ovRoom'); await targets(page, 'ovRoom');
  await capture(page, `room-${width}x${height}-top`);
  // A scannable canvas can still be hidden by the sticky actions. Expose it
  // with ordinary panel scrolling, then test the whole square, not its center.
  const qr = page.locator('#roomQr');
  await qr.evaluate(n => n.scrollIntoView({ block: 'start', inline: 'nearest' }));
  const qrBounds = await qr.evaluate(async n => {
    let previous = '', stable = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const r = n.getBoundingClientRect(), p = n.closest('.panel').getBoundingClientRect();
      const dock = n.closest('.panel').querySelector('.dock').getBoundingClientRect();
      const bounds = { top: r.top, right: r.right, bottom: r.bottom, left: r.left,
        width: r.width, height: r.height, panelTop: p.top, panelBottom: p.bottom,
        footerTop: dock.top, viewportWidth: innerWidth, viewportHeight: innerHeight };
      const current = JSON.stringify(bounds);
      stable = current === previous ? stable + 1 : 0;
      if (stable >= 3) return bounds;
      previous = current;
    }
    throw new Error('Room QR bounds did not settle after normal scrolling');
  });
  await capture(page, `room-${width}x${height}-qr`);
  assert.ok(qrBounds.width > 0 && Math.abs(qrBounds.width - qrBounds.height) <= 1,
    'room invite QR remains a nonempty square');
  assert.ok(qrBounds.left >= -1 && qrBounds.right <= qrBounds.viewportWidth + 1
    && qrBounds.top >= Math.max(0, qrBounds.panelTop) - 1
    && qrBounds.bottom <= Math.min(qrBounds.viewportHeight, qrBounds.panelBottom, qrBounds.footerTop) + 1,
    `entire room QR is readable above the sticky footer after normal scrolling: ${JSON.stringify(qrBounds)}`);
  for (const id of ['btnRoomCopy', 'roomApprove', 'btnRoomNewLink', 'btnRoomNewWorld', 'btnRoomLeave', 'btnRoomPlay', 'btnRoomBack']) await reachable(page, '#' + id);
  await capture(page, `room-${width}x${height}-actions`);
  const socketsBefore = relayClient.sockets;
  await keyboardClose(page, 'ovRoom', 'btnRoomBack');
  assert.equal(await page.evaluate(() => SpaceManNet.active), true, 'Back keeps the existing room connected');
  await activate(page, '#btnTogether'); await panel(page, 'ovRoom');
  assert.equal(await page.evaluate(() => SpaceManNet.info().seed), state.seed, 'reopening keeps the same room');
  assert.equal(relayClient.sockets, socketsBefore, 'reopening does not create a duplicate connection');
  await page.keyboard.press('Escape'); await home(page);
  await activate(page, '#btnTogether'); await panel(page, 'ovRoom');
  await activate(page, '#btnRoomLeave'); await home(page);
  assert.equal(await page.evaluate(() => SpaceManNet.active), false, 'Leave disconnects the isolated one-person room');
});

test('secondary initials: real qualifying run, labeled letter controls and immediate retry', { timeout: 60000 }, async t => {
  const { page } = await launch(t, { width: 390, height: 844 }, { populated: false, course: true });
  // A full low-score saved board is the fixture; the qualifying result is earned
  // by genuine movement. Seed storage, then reload through the normal loader.
  await page.evaluate(() => {
    localStorage.setItem(SpaceManBuild.storageKey('sm2.top5'), JSON.stringify([5, 4, 3, 2, 1].map(score => ({ initials: 'OLD', score, dist: score, chain: 1 }))));
  });
  await page.reload(); await home(page);
  await activate(page, '#btnPlay'); await page.waitForFunction(() => G.mode === 'play');
  await page.keyboard.down('ArrowRight');
  try { await page.waitForFunction(() => G.dist >= 12); } finally { await page.keyboard.up('ArrowRight'); }
  await page.waitForFunction(() => G.mode === 'dead' && G.showPicker, undefined, { timeout: 25000 });
  await panel(page, 'ovInitials');
  assert.equal(await page.evaluate(() => G.showPicker), true);
  for (const direction of ['Next', 'Previous']) for (let i = 1; i <= 3; i++) assert.equal(await page.getByRole('button', { name: `${direction} letter ${i}`, exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Next letter 1', exact: true }).click();
  await page.getByRole('button', { name: 'Previous letter 2', exact: true }).click();
  const initials = (await page.locator('#initialsPicker .initial-char').allTextContents()).join('');
  await fit(page, 'ovInitials'); await targets(page, 'ovInitials'); await capture(page, 'initials-phone');
  await activate(page, '#btnInitialsOk'); await panel(page, 'ovDead');
  assert.equal((await stored(page, 'top5'))[0].initials, initials);
  assert.equal(await page.locator('#deadScores tr.me td:nth-child(2)').innerText(), initials);
  await page.waitForFunction(() => G.time - G.deadShownAt >= 0.5);
  await activate(page, '#btnAgain'); await page.waitForFunction(() => G.mode === 'play' && !G.player.dead);
});


test('secondary first invite: cancel before choosing; commit dismisses picker; Cancel interrupts slow admission without erasing identity', { timeout: 65000 }, async t => {
  const hub = require('../harness.cjs').relay();
  const host = await launch(t, { width: 1440, height: 900 }, { relay: true, hub });
  await activate(host.page, '#btnTogether'); await panel(host.page, 'ovTogether');
  await activate(host.page, '#btnCreateRoom'); await panel(host.page, 'ovRoom');
  const invite = await host.page.evaluate(() => SpaceManNet.info().link);
  const { page, relayClient } = await launch(t, { width: 390, height: 844 }, { relay: true, hub, callsign: false });
  await activate(page, '#btnTogether'); await panel(page, 'ovTogether');
  await page.locator('#joinInput').fill(invite); await page.locator('#joinInput').press('Enter');
  await panel(page, 'ovJoin'); await targets(page, 'ovJoin');
  await activate(page, '#btnJoinPlay'); await panel(page, 'ovCallsign');
  await page.getByRole('button', { name: 'Next noun', exact: true }).click();
  await activate(page, '#btnCallsignCancel'); await panel(page, 'ovJoin');
  assert.equal(await page.evaluate(() => hasCallsign()), false, 'pre-commit Cancel saves no suggested identity');
  assert.equal(relayClient.sockets, 0, 'pre-commit Cancel never starts admission');
  assert.equal(await page.locator('#btnJoinPlay').isVisible(), true, 'the original invite remains actionable');

  // Withhold only opaque encrypted relay frames. The guest still performs its
  // genuine handshake, identity commit and UI continuation; no game state,
  // timers, callsign handler or admission result is replaced.
  hub.admissionPaused = true;
  await activate(page, '#btnJoinPlay'); await panel(page, 'ovCallsign');
  const chosen = await page.locator('#callsignPreview').innerText();
  await activate(page, '#btnCallsignDone'); await panel(page, 'ovJoin');
  await page.waitForFunction(() => joining && /waiting for the host/i.test(document.getElementById('joinState').textContent));
  assert.equal(await page.locator('#ovCallsign').isVisible(), false, 'committed picker is fully dismissed during the pending join');
  assert.equal(await page.locator('.overlay.show').count(), 1, 'only the pending Join dialog owns input');
  assert.equal(await page.locator('#btnJoinNotNow').innerText(), 'Cancel');
  await require('../harness.cjs').until(() => relayClient.encryptedSent > 0, 'guest sends its genuine encrypted admission request');
  assert.ok(relayClient.sockets > 0 && relayClient.encryptedSent > 0, 'pending state follows a real simulated-relay connection attempt');
  const saved = (await stored(page, 'cosmetics')).callsign;
  assert.equal(await page.evaluate(() => hasCallsign()), true, 'Use callsign commits before asynchronous admission');
  await fit(page, 'ovJoin'); await targets(page, 'ovJoin'); await capture(page, 'join-pending-after-callsign');
  await activate(page, '#btnJoinNotNow'); await home(page);
  await page.waitForFunction(() => !joining && !SpaceManNet.active && !SpaceManNet._n1.session());
  hub.admissionPaused = false;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#ovJoin').isVisible(), false, 'late cancellation settlement cannot reopen the invite');
  assert.equal(await page.locator('#ovCallsign').isVisible(), false);
  assert.deepEqual((await stored(page, 'cosmetics')).callsign, saved, 'admission Cancel cannot undo the already committed callsign');
  assert.equal(await page.locator('#homeCallsign').innerText(), chosen);
  await page.reload(); await home(page);
  assert.equal(await page.locator('#homeCallsign').innerText(), chosen, 'committed identity survives cancellation and reload');
  await activate(host.page, '#btnRoomLeave'); await home(host.page);
});
