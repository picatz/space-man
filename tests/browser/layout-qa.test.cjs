'use strict';
// Layout QA guard: opens every main screen at phone, tablet and laptop sizes and
// fails on the jank playtesters hit first: horizontal page overflow, controls
// that extend past the viewport, and fixed or sticky chrome covering a control
// even after it is scrolled into view. Known failures are listed in KNOWN with
// the issue to fix; they run as node:test todos so CI stays green until fixed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_QA_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_QA_SCREENSHOTS;
const viewports = [[390, 844], [768, 1024], [1280, 800]];

// Each screen opens from a fresh home and resolves once it is on screen.
const screens = {
  home: async () => {},
  run: async page => { await activate(page, 'btnPlay'); await page.waitForFunction(() => G.mode === 'play'); await page.waitForTimeout(400); },
  arena: async page => { await activate(page, 'btnArena'); await page.locator('.arena-root[data-screen=lobby]').waitFor(); },
  circuit: async page => { await activate(page, 'btnRace'); await page.locator('.race-root[data-screen=lobby]').waitFor(); },
  together: async page => { await activate(page, 'btnTogether'); await page.locator('#ovTogether.show').waitFor(); },
  wardrobe: async page => { await activate(page, 'btnWardrobe'); await page.locator('#ovWardrobe.show').waitFor(); },
  records: async page => { await activate(page, 'btnTrophy'); await page.locator('#ovTrophy.show').waitFor(); },
};

// "<screen> <width>x<height>" -> the issue that still needs fixing. Remove an
// entry when its fix lands; the todo then becomes a hard check again.
const KNOWN = {};

async function launch(t, viewport) {
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
  const mobile = viewport.width < 1000;
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', ws => ws.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no runtime errors'));
  return { page, base };
}
async function home(page, base) {
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
  await page.evaluate(() => { settings.muted = true; return document.fonts.ready; });
}
async function activate(page, id) {
  const button = page.locator('#' + id);
  if (page.viewportSize().width < 1000) await button.tap(); else await button.click();
}

// Runs in the page with the configured viewport size (a mobile browser widens
// innerWidth to fit overflowing content). Returns human-readable problems.
function audit([W, H]) {
  const problems = [];
  const label = n => n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : '') + (n.textContent.trim() ? ` "${n.textContent.trim().slice(0, 24)}"` : '');
  const doc = document.documentElement;
  const scrollWidth = Math.max(innerWidth, doc.scrollWidth, document.body.scrollWidth);
  if (scrollWidth > W + 1) problems.push(`page overflows horizontally: ${scrollWidth} > ${W}`);
  const shown = n => n.getClientRects().length && !n.closest('[inert],[aria-hidden=true]') &&
    (!n.checkVisibility || n.checkVisibility({ opacityProperty: true, visibilityProperty: true })) &&
    getComputedStyle(n).pointerEvents !== 'none';
  const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[tabindex]:not([tabindex="-1"])')].filter(shown);
  const pinned = n => { for (; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; };
  // Elements inside a horizontal scroller may legitimately sit off screen.
  const inScroller = n => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  for (const n of controls) {
    const b = n.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    if ((b.left < -1 || b.right > W + 1) && !inScroller(n)) problems.push(`${label(n)} extends past the viewport (${Math.round(b.left)}..${Math.round(b.right)} of ${W})`);
  }
  for (const n of controls) {
    let b = n.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    const covered = () => {
      b = n.getBoundingClientRect();
      const x = Math.min(W - 1, Math.max(0, b.left + b.width / 2)), y = b.top + b.height / 2;
      if (y < 0 || y >= H) return null;
      const top = document.elementFromPoint(x, y);
      if (!top || top === n || n.contains(top) || top.contains(n)) return null;
      const cover = pinned(top);
      return cover && !cover.contains(n) ? cover : null;
    };
    if (!covered()) continue;
    n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const cover = covered();
    if (cover) problems.push(`${label(n)} is covered by fixed/sticky ${label(cover)}`);
  }
  return [...new Set(problems)];
}

for (const [width, height] of viewports) {
  for (const [name, open] of Object.entries(screens)) {
    const key = `${name} ${width}x${height}`;
    const todo = KNOWN[key];
    test(`layout qa: ${key}`, todo ? { todo } : {}, async t => {
      const { page, base } = await launch(t, { width, height });
      await home(page, base);
      await open(page);
      if (SHOTS) { await fs.mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `qa-${engineName}-${name}-${width}x${height}.png`) }); }
      assert.deepEqual(await page.evaluate(audit, [width, height]), [], `${key} layout problems`);
    });
  }
}

test('layout qa: the audit catches overflow, off-screen and covered controls', async t => {
  const { page, base } = await launch(t, { width: 390, height: 844 });
  await home(page, base);
  const problems = await page.evaluate(audit => {
    const wide = Object.assign(document.createElement('button'), { id: 'qaWide', textContent: 'wide' });
    wide.style.cssText = 'position:absolute;left:300px;top:0;width:300px';
    const cover = Object.assign(document.createElement('div'), { id: 'qaCover' });
    const b = document.getElementById('btnPlay').getBoundingClientRect();
    cover.style.cssText = `position:fixed;left:0;right:0;top:${b.top}px;height:${b.height}px;z-index:2147483647`;
    document.body.append(wide, cover);
    return eval(`(${audit})`)([390, 844]);
  }, audit.toString());
  assert.ok(problems.some(p => p.startsWith('page overflows horizontally')), problems.join('\n'));
  assert.ok(problems.some(p => p.startsWith('#qaWide extends past')), problems.join('\n'));
  assert.ok(problems.some(p => /is covered by fixed\/sticky #qaCover$/.test(p)), problems.join('\n'));
});
