'use strict';
// Layout QA guard: opens every main screen at phone, tablet and laptop sizes and
// fails on the jank playtesters hit first: horizontal page overflow, controls
// that extend past the viewport, and fixed or sticky chrome covering a control
// even after it is scrolled into view. Controls and their copy (card names,
// labels, captions) are also scrolled to each edge of their scroller, where
// keyboard focus and a finger's last scroll leave them, and must not sit behind
// a sticky footer or header there (WCAG 2.2 SC 2.4.11, Focus Not Obscured). Known failures are listed in KNOWN with
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
  // Edge pass: only content inside a vertical scroller that shares it with
  // pinned chrome can slide under that chrome. Each control and line of copy
  // is aligned to the scroller's top and bottom edge in turn; three points
  // down its middle must then hit the element itself, not the pinned layer.
  const scroller = n => { for (let p = n.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p; if (p === document.documentElement) return null; } return null; };
  const copy = [...document.querySelectorAll('h1,h2,h3,p,small,strong,label,summary,li')].filter(n => shown(n) && n.textContent.trim() && !n.closest('button,a[href],[role=button]'));
  // The nearest fixed or sticky layer between n and its scroller, if any.
  const pinnedIn = (n, box) => { for (; n && n !== box; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; };
  const scrollers = new Map();
  for (const n of [...controls, ...copy]) {
    const box = scroller(n);
    if (box && !pinnedIn(n, box)) scrollers.set(box, [...(scrollers.get(box) || []), n]);
  }
  for (const [box, items] of scrollers) {
    const before = box.scrollTop;
    for (const n of items) {
      for (const block of ['start', 'end']) {
        n.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
        const b = n.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const x = Math.min(W - 1, Math.max(0, b.left + b.width / 2));
        for (const y of [b.top + b.height * .25, b.top + b.height / 2, b.bottom - b.height * .25]) {
          if (y < 0 || y >= H) continue;
          const top = document.elementFromPoint(x, y);
          if (!top || top === n || n.contains(top) || top.contains(n)) continue;
          const cover = box.contains(top) ? pinnedIn(top, box) : pinned(top);
          if (cover && !cover.contains(n)) { problems.push(`${label(n)} hides behind fixed/sticky ${label(cover)} at the ${block === 'end' ? 'bottom' : 'top'} of its scroller`); break; }
        }
      }
    }
    box.scrollTop = before;
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

test('layout qa: the audit catches copy and controls hidden behind a sticky footer', async t => {
  const { page, base } = await launch(t, { width: 390, height: 844 });
  await home(page, base);
  const problems = await page.evaluate(audit => {
    document.getElementById('ovAttract').inert = true;
    // A scrolling panel whose sticky footer overlays the last rows, like the
    // Star Circuit lobby before its Launch bar became a real footer.
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:#000';
    for (let i = 0; i < 12; i++) {
      const row = document.createElement('p');
      row.style.cssText = 'height:90px;margin:0';
      row.textContent = 'qa row ' + i;
      panel.append(row);
    }
    const bar = document.createElement('div');
    bar.id = 'qaSticky';
    bar.style.cssText = 'position:sticky;bottom:0;height:120px;margin-top:-120px;background:#333';
    panel.append(bar);
    document.body.append(panel);
    return eval(`(${audit})`)([390, 844]);
  }, audit.toString());
  assert.ok(problems.some(p => /^p "qa row 11" hides behind fixed\/sticky #qaSticky at the bottom/.test(p)), problems.join('\n'));
});

// Arena on a phone: the scoreboard, the play area and the spectator dock must
// share the screen without covering each other. A pilot knocked out of a solo
// match watches the CPUs: fighter controls give way to the dock, and cards,
// keys and swipes all pick who the camera follows.
async function arenaKnockout(page) {
  await activate(page, 'btnArena'); await page.locator('.arena-root[data-screen=lobby]').waitFor();
  await page.locator('[data-format=ffa]').click(); await page.locator('[data-arena=ember-foundry]').click();
  await page.locator('#arenaStart').click();
  await page.waitForFunction(() => arenaUI.snapshot()?.phase === 'playing', null, { timeout: 15000 });
}
const rect = (page, selector) => page.locator(selector).first().evaluate(n => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
for (const [width, height] of [[390, 844], [844, 390]]) {
  test(`layout qa: arena phone HUD and spectator dock ${width}x${height}`, async t => {
    const { page, base } = await launch(t, { width, height });
    await home(page, base);
    await arenaKnockout(page);
    // Fighting on touch: the DASH meter sits below its label, never through it.
    await page.touchscreen.tap(width / 2, height / 2);
    await page.locator('.arena-touch-dash').waitFor();
    const dash = await page.locator('.arena-touch-dash').evaluate(b => { const word = b.querySelector('.arena-touch-word').getBoundingClientRect(), box = b.getBoundingClientRect(), after = getComputedStyle(b, '::after'); return { word: word.bottom, meter: box.bottom - parseFloat(after.bottom) - parseFloat(after.height) }; });
    assert.ok(dash.meter >= dash.word, `dash meter (${dash.meter}) clears its label (${dash.word})`);
    if (width < height) {
      const hud = await rect(page, '.arena-hud');
      assert.ok(hud.bottom <= height * .2, `phone scoreboard stays in the top fifth (bottom ${Math.round(hud.bottom)} of ${height})`);
      for (const name of await page.locator('.arena-player-card:not([data-you=true]) .arena-player-name-text').all()) assert.ok(await name.evaluate(n => n.scrollWidth <= n.clientWidth + 1), `${await name.textContent()} is not truncated`);
    }
    await page.keyboard.down('d');
    await page.waitForFunction(() => arenaUI.snapshot().actors[0].stocks <= 0, null, { timeout: 60000, polling: 100 });
    await page.keyboard.up('d');
    await page.touchscreen.tap(width / 2, height / 2);
    await page.locator('#arenaWatchNext').waitFor();
    assert.equal(await page.locator('.arena-touch').isVisible(), false, 'fighter controls give way to the spectator dock');
    assert.equal(await page.locator('#arenaWatchRematch').isVisible(), true, 'a solo pilot can rematch without waiting');
    const dock = await rect(page, '.arena-watch-tools'), roster = await rect(page, '.arena-roster');
    assert.ok(!overlaps(dock, roster), 'dock and scoreboard never overlap');
    assert.ok(dock.bottom <= height && dock.top >= 0, 'dock is on screen');
    if (width > height) assert.ok(dock.height <= 72, `landscape dock is one slim row (${dock.height}px)`);
    if (SHOTS) { await fs.mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `qa-${engineName}-arena-spectate-${width}x${height}.png`) }); }
    const watched = () => page.locator('#arenaWatchName').textContent();
    // The followed fighter is framed inside the clear area (its WATCHING cue is painted).
    await page.waitForFunction(() => /(^|,)WATCHING:/.test(document.querySelector('.arena-root').dataset.identity || ''), null, { timeout: 5000 });
    // Each way of switching changes who is followed.
    const twoToWatch = () => page.waitForFunction(() => arenaUI.snapshot().actors.filter(a => a.stocks > 0 && a.respawnTicks <= 0).length >= 2);
    await twoToWatch(); let before = await watched();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await watched(), before, 'arrow keys switch fighters');
    await twoToWatch(); before = await watched();
    const box = await rect(page, '.arena-canvas');
    await page.locator('.arena-canvas').evaluate((c, y) => { const at = x => ({ clientX: x, clientY: y, isPrimary: true, pointerId: 7, pointerType: 'touch', bubbles: true }); c.dispatchEvent(new PointerEvent('pointerdown', at(300))); c.dispatchEvent(new PointerEvent('pointerup', at(180))); }, (box.top + box.bottom) / 2);
    assert.notEqual(await watched(), before, 'a swipe switches fighters');
    // CPUs keep fighting, so a fighter can be knocked out between the pick
    // and the tap; retry with another eligible card rather than flake.
    let picked = '', followed = '';
    for (let attempt = 0; attempt < 4 && followed !== 'WATCHING ' + picked; attempt++) {
      const id = await page.evaluate(() => { const s = arenaUI.snapshot(), now = document.querySelector('.arena-player-card[data-watching=true]')?.dataset.actor; return s.actors.filter(a => a.stocks > 0 && a.respawnTicks <= 0 && String(a.id) !== now).sort((a, b) => a.damage - b.damage)[0]?.id; });
      if (!id) { await page.waitForTimeout(200); continue; }
      const card = page.locator(`.arena-player-card[data-actor="${id}"]`);
      picked = (await card.locator('.arena-player-name-text').textContent()).trim();
      await card.tap(); followed = await watched();
    }
    assert.equal(followed, 'WATCHING ' + picked, 'tapping a card follows that fighter');
    await page.locator('#arenaWatchRematch').tap();
    await page.waitForFunction(() => arenaUI.snapshot()?.actors[0].stocks > 0);
    await page.locator('.arena-touch').waitFor();
    assert.equal(await page.locator('.arena-watch-tools').isVisible(), false, 'a rematch puts the pilot back in control');
  });
}
