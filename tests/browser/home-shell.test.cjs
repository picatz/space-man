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
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  const errors = [], sockets = [], externalRequests = [];
  // Opening a friends front door must stay local. Prevent a regression from
  // contacting a real relay, then fail if any connection was even attempted.
  await context.routeWebSocket('**/*', ws => { sockets.push(ws.url()); ws.close(); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  if (controller) await context.addInitScript(() => {
    window.homeTestPad = { connected: true, mapping: 'standard', index: 0, id: 'Xbox home test', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [homeTestPad] });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => {
    assert.deepEqual(errors, [], 'no runtime errors');
    assert.deepEqual(sockets, [], 'no attempted relay/WebSocket connections');
    assert.deepEqual(externalRequests, [], 'no external HTTP requests');
  });
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { settings.muted = true; });
  if (process.env.SPACE_MAN_EXPECTED_SHA) assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha, process.env.SPACE_MAN_EXPECTED_SHA);
  return { page, context };
}

// Normal-motion interaction frames are essential: static/reduced-motion goldens
// cannot detect an image disappearing before its color becomes opaque.
async function sampleFrames(page, action, name, id = 'btnPlay') {
  await page.evaluate(id => {
    window.homePaintTarget = id;
    window.homePaintFrames = [];
    window.homePaintDone = new Promise(resolve => {
      function sample() {
        const b = document.getElementById(homePaintTarget), s = getComputedStyle(b.closest('.home-mode') || b);
        homePaintFrames.push({ background: s.backgroundColor, image: s.backgroundImage,
          opacity: s.opacity, filter: s.filter, hover: b.matches(':hover'), active: b.matches(':active') });
        if (homePaintFrames.length < 30) requestAnimationFrame(sample); else resolve();
      }
      requestAnimationFrame(sample);
    });
  }, id);
  await action();
  await page.evaluate(() => homePaintDone);
  const frames = await page.evaluate(() => homePaintFrames);
  for (const [i, f] of frames.entries()) {
    const color = f.background.match(/[\d.]+/g).map(Number);
    const alpha = color.length === 4 ? color[3] : 1;
    assert.ok(f.image !== 'none' || alpha >= .99, `${name} frame ${i}: continuous surface paint, ${JSON.stringify(f)}`);
    if (id !== 'btnWardrobeDone') assert.equal(f.image, frames[0].image, `${name} frame ${i}: mode surface never disappears`);
    assert.ok(Number(f.opacity) >= .99, `${name} frame ${i}: visible button`);
  }
  if (SHOTS) { await fs.mkdir(SHOTS, {recursive:true}); await page.screenshot({path:path.join(SHOTS, `${engineName}-${name}.png`)}); }
  return frames;
}

test('home normal-motion mode and Done hover, focus and press keep continuously painted surfaces', {timeout:60000}, async t => {
  const {page} = await launch(t);
  // Hidden legacy control still keeps the regression fix in its stylesheet.
  assert.equal(await page.locator('#btnExpedition').isVisible(), false);
  assert.equal(await page.locator('#btnExpedition').evaluate(e=>getComputedStyle(e).backgroundColor), 'rgb(255, 205, 124)');
  for (const id of ['btnPlay','btnArena','btnRace','btnWardrobeDone']) {
    if(id === 'btnWardrobeDone') { await page.locator('#btnWardrobe').click(); await page.locator('#ovWardrobe.in').waitFor(); await page.waitForTimeout(500); }
    const button = page.locator('#'+id);
    await button.scrollIntoViewIfNeeded(); await page.mouse.move(5,5);
    await sampleFrames(page, () => button.hover(), id+'-hover-enter', id);
    await sampleFrames(page, () => page.mouse.move(5,5), id+'-hover-leave', id);
    await sampleFrames(page, () => button.hover(), id+'-hover-reenter', id);
    await sampleFrames(page, async () => { await button.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); }, id+'-keyboard-focus', id);
    assert.equal(await button.evaluate(e => e === document.activeElement && e.matches(':focus-visible')), true, 'actual keyboard focus remains visible');
    const frames = await sampleFrames(page, () => page.mouse.down(), id+'-held-press', id);
    assert.ok(frames.some(f => f.active), 'captured actual pressed frames');
    await page.mouse.move(5,5); await page.mouse.up();
    await sampleFrames(page, () => button.hover(), id+'-release-reenter', id);
  }
});

for (const [width,height] of [[320,568],[390,844],[430,932],[667,375],[844,390],[768,1024],[820,1180],[1024,768],[1440,900]]) {
  test(`home shell ${width}x${height}: deliberate indicator and reachable overflow`, {timeout:30000}, async t => {
    const {page,context} = await launch(t,{width,height});
    const shell = page.locator('.home-shell');
    const style = await shell.evaluate(e => ({scrollbar:getComputedStyle(e).scrollbarWidth, gutter:getComputedStyle(e).scrollbarGutter, overflow:getComputedStyle(e).overflowY, coarse:matchMedia('(pointer:coarse)').matches}));
    assert.equal(style.overflow,'auto','content remains scrollable');
    if(style.coarse) assert.equal(style.scrollbar,'none','touch shell has no intrusive indicator');
    else assert.ok(style.gutter.includes('stable'),'desktop scrollbar gets reserved space');
    for(const id of entries) {
      const b=page.locator('#'+id); await b.scrollIntoViewIfNeeded();
      assert.equal(await b.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.y>=0&&r.bottom<=innerHeight+1&&(hit===e||e.contains(hit));}),true,id+' fully reachable and not covered');
    }
    assert.equal(await shell.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'no horizontal overflow');
    // Constrained window makes overflow real, then native wheel and Tab must
    // expose the footer without changing body position or disabling scrolling.
    await page.setViewportSize({width,height:Math.min(height,280)});
    await shell.evaluate(e=>e.scrollTop=0);
    assert.ok(await shell.evaluate(e=>e.scrollHeight>e.clientHeight),'test genuinely overflows');
    const box=await shell.boundingBox(); await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.wheel(0,2000);
    await page.waitForFunction(()=>document.querySelector('.home-shell').scrollTop>0);
    await page.locator('#btnPlay').focus();
    for(let i=0;i<12&&await page.evaluate(()=>document.activeElement.id!=='btnSettings');i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'btnSettings','keyboard reaches final action');
    assert.equal(await page.locator('#btnSettings').evaluate(e=>{const r=e.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight;}),true,'focused footer is visible');
    assert.equal(await page.evaluate(()=>scrollY),0,'body stays locked');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setViewportSize({width:height,height:width});
    await page.locator('#btnSettings').scrollIntoViewIfNeeded();
    assert.equal(await shell.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'rotation retains horizontal fit');
  });
}
