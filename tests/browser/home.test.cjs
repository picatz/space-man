'use strict';
// Exercise the shipped home and real entry/return handlers. Art assertions read
// production canvas pixels; no mocked game, forced outcomes or relay sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_HOME_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_HOME_SCREENSHOTS;
const entries = [ 'btnPlay', 'btnArena', 'btnRace', 'btnTogether', 'btnDaily', 'btnWardrobe', 'btnTrophy', 'btnSettings'];
const sizes = [[320, 568], [390, 844], [667, 375], [820, 1180], [1440, 900]];

async function launch(t, viewport = { width: 1440, height: 900 }, controller = false) {
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
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
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [], sockets = [], externalRequests = [];
  // Opening a friends front door must stay local. Prevent a regression from
  // contacting a real relay, then fail if any connection was even attempted.
  await context.routeWebSocket('**/*', ws => { sockets.push(ws.url()); ws.close(); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  if (controller) await context.addInitScript(id => {
    window.homeTestPad = { connected: true, mapping: 'standard', index: 0, id, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [homeTestPad] });
  }, typeof controller === 'string' ? controller : 'Xbox home test');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => {
    assert.deepEqual(errors, [], 'no runtime errors');
    assert.deepEqual(sockets, [], 'no attempted relay/WebSocket connections');
    assert.deepEqual(externalRequests, [], 'no external HTTP requests');
  });
  await page.goto(base);
  await home(page);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { settings.muted = true; });
  if (process.env.SPACE_MAN_EXPECTED_SHA) assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha, process.env.SPACE_MAN_EXPECTED_SHA);
  return { page, context };
}
async function home(page) {
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
}
async function capture(page, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(SHOTS, `${engineName}-${name}.png`) });
}
async function resetScroll(page) { await page.locator('.home-shell').evaluate(n => { n.scrollTop = 0; }); }
async function fit(page) {
  const problems = await page.evaluate(() => {
    const selectors = ['#ovAttract', '.home-shell', '.home-header', '.home-world', '.home-launch', '.home-play-actions', '.launch-modes', '.home-mode', '.home-footer', '#btnDaily', '#homeCallsign'];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).filter(n => n.getClientRects().length).flatMap(n => {
      const b = n.getBoundingClientRect();
      return n.scrollWidth > n.clientWidth + 1 || b.left < -1 || b.right > innerWidth + 1 ? [{ selector, width: n.clientWidth, scroll: n.scrollWidth, left: b.left, right: b.right }] : [];
    }));
  });
  assert.deepEqual(problems, [], 'no horizontal overflow or clipped home content');
}
async function reachable(page, id) {
  const node = page.locator('#' + id);
  await node.scrollIntoViewIfNeeded();
  const result = await node.evaluate(n => {
    const b = n.getBoundingClientRect(), target = n.closest('.home-mode') || n, t = target.getBoundingClientRect();
    // The native card button owns its illustration, title and surrounding space.
    const x = b.left + b.width / 2, y = b.top + b.height / 2, hit = document.elementFromPoint(x, y);
    return { x: b.left, y: b.top, right: b.right, bottom: b.bottom, width: t.width, height: t.height, hit: hit === n || n.contains(hit), enabled: !n.disabled, viewport: [innerWidth, innerHeight] };
  });
  assert.ok(result.width >= 44 && result.height >= 44, `${id}: effective touch target is at least 44px`);
  assert.ok(result.x >= -1 && result.y >= -1 && result.right <= result.viewport[0] + 1 && result.bottom <= result.viewport[1] + 1, `${id}: reachable inside the viewport`);
  assert.ok(result.hit && result.enabled, `${id}: not covered by decoration or another control`);
}
async function activate(page, id) {
  const button = page.locator('#' + id);
  if (page.viewportSize().width < 1000) await button.tap(); else await button.click();
}
async function assertReturnFocus(page, id, keyboard = false) {
  const active = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName }));
  // Touch WebKit can clear programmatic button focus after a pointer-owned
  // dismissal. BODY is the only accepted alternative, never a hidden dialog or
  // unrelated control. Keyboard/controller restoration is tested strictly.
  const pointerWebKit = !keyboard && engineName === 'webkit' && page.viewportSize().width < 1000;
  assert.ok(active.id === id || (pointerWebKit && active.tag === 'BODY' && active.id === ''),
    `${id}: return focus ${JSON.stringify(active)}${keyboard ? ' after keyboard activation' : ''}`);
  assert.equal(await page.locator('#' + id).isVisible(), true, 'return destination remains visible');
}
async function stopRun(page) {
  await page.waitForFunction(() => G.mode === 'play');
  await page.keyboard.press('Escape');
  await page.locator('#ovPause.show').waitFor();
  await page.locator('#btnQuit').click();
  await home(page);
}
async function artPixels(page) {
  return page.evaluate(() => Object.fromEntries(['homeHero', 'homeRunArt', 'homeArenaArt', 'homeRaceArt'].map(id => {
    const c = document.getElementById(id), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    // Compare raw RGBA, not PNG encoder output. Chunking avoids argument-size
    // limits on WebKit; base64 keeps browser-protocol transfers compact.
    let bytes = ''; for (let i = 0; i < data.length; i += 16384) bytes += String.fromCharCode(...data.subarray(i, i + 16384));
    return [id, { rgba: btoa(bytes), opaque, width: c.width, height: c.height }];
  })));
}
function assertSameArt(actual, expected, allowRasterRounding = false) {
  for (const id of Object.keys(expected)) {
    const a = actual[id], b = expected[id];
    assert.deepEqual({ width: a.width, height: a.height, opaque: a.opaque },
      { width: b.width, height: b.height, opaque: b.opaque }, `${id}: image dimensions and coverage are stable`);
    const next = Buffer.from(a.rgba, 'base64'), previous = Buffer.from(b.rgba, 'base64');
    assert.equal(next.length, previous.length, `${id}: same raw pixel count`);
    let changedPixels = 0, maxChannelDelta = 0, totalDelta = 0;
    for (let i = 0; i < next.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(next[i + channel] - previous[i + channel]);
        changed ||= delta !== 0; maxChannelDelta = Math.max(maxChannelDelta, delta); totalDelta += delta;
      }
      if (changed) changedPixels++;
    }
    // A reload may change a few antialiased edge channels by 1–2 levels in
    // WebKit. Bound both the affected area and total error; never accept a
    // changed shape, color, accessory, blank canvas or different appearance.
    const pixels = next.length / 4, maxChanged = allowRasterRounding ? Math.ceil(pixels * .0025) : 0;
    const meanChannelDelta = totalDelta / next.length;
    const summary = { changedPixels, maxChanged, maxChannelDelta, meanChannelDelta };
    assert.ok(changedPixels <= maxChanged && maxChannelDelta <= (allowRasterRounding ? 2 : 0) && meanChannelDelta <= (allowRasterRounding ? .005 : 0),
      `${id}: saved outfit pixels remain stable ${JSON.stringify(summary)}`);
  }
}

for (const [width, height] of sizes) test(`home ${width}x${height}: exact screenshots, every entry, real launch and return`, { timeout: 90000 }, async t => {
  const { page } = await launch(t, { width, height });
  await capture(page, `home-${width}x${height}-top`);
  await fit(page);
  if ((width < 760 && height > 560) || (width >= 760 && width <= 1000 && height >= 700)) {
    const boxes = await page.evaluate(() => ['.home-header', '#homeHero', '.home-identity', '.home-launch'].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }));
    assert.ok(boxes[1].top >= boxes[0].bottom - 1, 'hero stays below the brand header');
    assert.ok(boxes[2].top >= boxes[1].bottom - 2, 'identity stays below the illustration');
    assert.ok(boxes[3].top >= boxes[2].bottom - 1, 'adventure copy never overlaps the hero identity');
  }
  const art = await artPixels(page);
  for (const [id, pixels] of Object.entries(art)) assert.ok(pixels.opaque > 500, `${id}: production illustration is painted`);
  for (const id of entries) await reachable(page, id);
  await capture(page, `home-${width}x${height}-utilities`);
  await resetScroll(page);
  // The first action is visible even on the smallest phone and landscape view.
  const primary = await page.locator('#btnPlay').boundingBox();
  assert.ok(primary.y >= 0 && primary.y + primary.height <= height + 1, 'Endless Run is visible without scrolling');

  assert.equal(await page.locator('#btnExpedition').isVisible(), false, 'mixed adventure is absent from launcher');
  assert.equal(await page.locator('#btnExpeditionFriends').isVisible(), false, 'mixed friends entry is absent from launcher');

  await activate(page, 'btnPlay'); await stopRun(page);
  await activate(page, 'btnArena'); await page.locator('.arena-root[data-screen=lobby]').waitFor();
  await page.locator('.arena-launch').click(); await page.locator('.arena-root[data-screen=match]').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'All games', exact: true }).filter({ visible: true }).click();
  await home(page); await assertReturnFocus(page, 'btnArena');
  await activate(page, 'btnRace'); await page.locator('.race-root[data-screen=lobby]').waitFor();
  await page.locator('.race-launch').click(); await page.locator('.race-root[data-screen=play]').waitFor();
  await page.keyboard.press('Escape'); await page.locator('#raceExit').click();
  await home(page); await assertReturnFocus(page, 'btnRace');

  await activate(page, 'btnDaily'); await page.waitForFunction(() => G.mode === 'play');
  assert.equal(await page.evaluate(() => G.course?.kind), 'daily');
  await stopRun(page);
  await activate(page, 'btnTogether'); await page.locator('#ovTogether.show').waitFor();
  await page.locator('#btnTogetherBack').click(); await home(page);
  await activate(page, 'btnTrophy'); await page.locator('#ovTrophy.show').waitFor();
  await page.locator('#btnCloseTrophy').click(); await home(page);
  await activate(page, 'btnSettings'); await page.locator('#ovSettings.show').waitFor();
  await page.locator('#btnCloseSettings').click(); await home(page);
  await activate(page, 'btnWardrobe'); await page.locator('#ovWardrobe.show').waitFor();
  await page.locator('#btnWardrobeDone').click(); await home(page);
  await fit(page); await resetScroll(page); await capture(page, `home-${width}x${height}-returned`);
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`home ${width}x${height}: outfit pixels and callsign persist through real controls and reload`, { timeout: 60000 }, async t => {
  const { page } = await launch(t, { width, height });
  const before = await artPixels(page);
  await activate(page, 'btnWardrobe');
  for (const [slot, id] of [['suit', 'mint'], ['hat', 'antenna'], ['eyes', 'happy'], ['helmet', 'bubble'], ['detail', 'stripe'], ['ship', 'orbit']]) {
    await page.locator('#wardTab-' + slot).click();
    await page.locator(`[data-cosmetic="${id}"]`).click();
    assert.equal(await page.locator(`[data-cosmetic="${id}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#wardCallsignRow').click();
  await page.locator('#ovCallsign.show').waitFor();
  await page.locator('#callsignCols .arrow-btn').first().click();
  const callsign = await page.locator('#callsignPreview').innerText();
  assert.ok(callsign.trim());
  await page.locator('#btnCallsignDone').click();
  await page.locator('#btnWardrobeDone').click(); await home(page);
  assert.equal(await page.locator('#homeCallsign').innerText(), callsign);
  const appearance = await page.evaluate(() => equippedAppearance());
  assert.deepEqual(appearance, { v: 1, suit: 'mint', hat: 'antenna', eyes: 'happy', helmet: 'bubble', detail: 'stripe', ship: 'orbit' });
  const equipped = await artPixels(page);
  for (const id of Object.keys(before)) assert.ok(equipped[id].rgba !== before[id].rgba, `${id}: equipped appearance changes real pixels`);
  await capture(page, `home-${width}x${height}-equipped`);
  await page.reload(); await home(page);
  assert.deepEqual(await page.evaluate(() => equippedAppearance()), appearance);
  assert.equal(await page.locator('#homeCallsign').innerText(), callsign);
  assertSameArt(await artPixels(page), equipped, engineName === 'webkit');
  await fit(page); await capture(page, `home-${width}x${height}-equipped-reloaded`);
});

test('keyboard and controller focus, standalone entries, and saved reduced motion', { timeout: 60000 }, async t => {
  const { page } = await launch(t, { width: 1440, height: 900 }, true);
  await page.waitForFunction(() => input.pad.connected);
  await page.locator('#btnPlay').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnArena');
  assert.equal(await page.locator('#btnArena').evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
  await page.locator('#btnWardrobe').focus(); await page.keyboard.press('Enter');
  await page.locator('#ovWardrobe.show').waitFor();
  await page.evaluate(() => { homeTestPad.buttons[1].pressed = true; });
  await home(page);
  await page.evaluate(() => { homeTestPad.buttons[1].pressed = false; });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnPlay', 'controller return selects the first standalone game');
  await page.keyboard.press('Enter'); await stopRun(page);
  await page.locator('#btnArena').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnRace');

  assert.equal(await page.evaluate(() => settings.reduceMotion), true);
  const stable = await artPixels(page); await page.waitForTimeout(300);
  assertSameArt(await artPixels(page), stable);
  assert.equal(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
  await page.locator('#btnSettings').click();
  const motion = page.locator('#ovSettings [data-setting=reduceMotion]');
  assert.equal(await motion.getAttribute('aria-checked'), 'true');
  await motion.click(); await page.locator('#btnCloseSettings').click(); await home(page);
  assert.ok(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration.split(',').some(v => parseFloat(v) > 0)), 'explicit motion setting restores hover feedback');
  await page.locator('#btnSettings').click(); await motion.click();
  await page.locator('#btnCloseSettings').click(); await home(page);
  await page.reload(); await home(page);
  assert.equal(await page.evaluate(() => settings.reduceMotion), true);
  assert.equal(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
});

test('home mirrors timed feedback above its opaque scene and points challenges at the runner', { timeout: 30000 }, async t => {
  const { page } = await launch(t, { width: 390, height: 844 });
  // UI feedback fixture uses the production queue; it does not open a relay.
  await page.evaluate(() => queueToast('Leave your room before starting a solo expedition.', 'sys'));
  const notice = page.locator('#homeNotice'); await notice.waitFor({ state: 'visible' });
  assert.equal(await notice.textContent(), 'Leave your room before starting a solo expedition.');
  const box = await notice.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 844);
  await capture(page, 'home-visible-room-guard-feedback');
  await notice.waitFor({ state: 'hidden' });
  const target = new URL(page.url()); target.hash = 'seed=77&beat=500';
  await page.goto(target.href); await page.reload(); await home(page);
  assert.match(await page.locator('#challengeBanner').innerText(), /Choose Endless Run to play/);
  await activate(page, 'btnPlay'); await page.waitForFunction(() => G.mode === 'play');
  assert.equal(await page.evaluate(() => G.course.seed), 77);
});

// Browser-standard DualSense mapping, not a physical Bluetooth/USB device claim.
test('simulated DualSense home focus, Cross activation, Options pause and Circle back', {timeout:30000}, async t => {
  const {page} = await launch(t, {width:1440,height:900}, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
  await page.waitForFunction(()=>input.pad.connected);
  assert.equal(await page.locator('body').getAttribute('data-pad'),'playstation');
  const release = async index => {
    await page.evaluate(i=>{homeTestPad.buttons[i].pressed=false;},index);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  const move = async (index,expected) => {
    await page.evaluate(i=>{homeTestPad.buttons[i].pressed=true;},index);
    await page.waitForFunction(id=>document.activeElement.id===id,expected);
    await release(index);
    const state=await page.locator('#'+expected).evaluate(e=>{const r=e.getBoundingClientRect();return {outline:getComputedStyle(e).outlineStyle,inView:r.top>=0&&r.bottom<=innerHeight};});
    assert.equal(state.outline,'solid'); assert.equal(state.inView,true);
  };
  await page.locator('#btnPlay').focus();
  await move(15,'btnArena'); await move(15,'btnRace');
  await move(14,'btnArena'); await move(14,'btnPlay');
  await page.evaluate(()=>{homeTestPad.buttons[0].pressed=true;});
  await page.waitForFunction(()=>G.mode==='play'); await release(0);
  assert.equal(await page.evaluate(()=>expedition),null,'Cross starts only the chosen standalone runner');
  await page.evaluate(()=>{homeTestPad.buttons[9].pressed=true;});
  await page.locator('#ovPause.show').waitFor(); await release(9);
  await page.locator('#btnQuit').click(); await home(page);
  await page.locator('#btnWardrobe').click(); await page.locator('#ovWardrobe.show').waitFor();
  await page.evaluate(()=>{homeTestPad.buttons[1].pressed=true;});
  await home(page); await release(1);
  assert.equal(await page.evaluate(()=>G.mode),'attract','Circle dismisses without starting a run');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'btnPlay','return focus is on visible primary mode');
});

for (const [width,height] of [[390,844],[1440,900]]) test(`home ${width}x${height}: illustration and card edge activate once on first tap and reopen`, {timeout:60000}, async t => {
  const {page} = await launch(t,{width,height});
  await page.evaluate(()=>{
    window.cardActivationCounts={};
    for(const id of ['btnPlay','btnArena','btnRace']) document.getElementById(id).addEventListener('click',()=>{cardActivationCounts[id]=(cardActivationCounts[id]||0)+1;});
  });
  for(const id of ['btnPlay','btnArena','btnRace']) {
    const button=page.locator('#'+id);
    assert.equal(await button.evaluate(e=>e.tagName),'BUTTON','whole card is one native control');
    assert.equal(await button.locator('button,a,input,[tabindex]').evaluateAll(nodes=>nodes.filter(n=>!(n.closest('.hapt')?.getAttribute('aria-hidden')==='true' && n.tabIndex===-1)).length),0,'no nested accessible or focus targets; the existing aria-hidden iOS haptic shim never becomes a second action');
    for(const region of ['illustration','edge']) {
      await button.scrollIntoViewIfNeeded();
      const point=await button.evaluate((e,region)=>{
        const r=(region==='illustration'?e.querySelector('canvas'):e).getBoundingClientRect();
        const x=region==='illustration'?r.x+r.width/2:r.x+4, y=r.y+r.height/2;
        const target=document.elementFromPoint(x,y);
        return {x,y,owner:target?.closest('button')?.id};
      },region);
      assert.equal(point.owner,id,region+' directly belongs to the card button');
      if(width<1000) await page.touchscreen.tap(point.x,point.y); else await page.mouse.click(point.x,point.y);
      if(id==='btnPlay') { await page.waitForFunction(()=>G.mode==='play'); await stopRun(page); }
      else {
        await page.locator(id==='btnArena'?'.arena-root[data-screen=lobby]':'.race-root[data-screen=lobby]').waitFor();
        await page.getByRole('button',{name:'← All games',exact:true}).filter({visible:true}).click();
        await home(page);
      }
      assert.equal(await page.evaluate(id=>cardActivationCounts[id],id),region==='illustration'?1:2,region+' triggers exactly once without a second tap');
      assert.equal(await page.evaluate(()=>expedition),null,'remains a standalone entry');
    }
  }
});
