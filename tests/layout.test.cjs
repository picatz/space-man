'use strict';
// Layout guarantees that need a real browser to measure but are easy to state in the stylesheet:
// every card fits the window and scrolls inside itself, and the buttons that matter stay docked on screen.
// (Checked against the source; the overlay fit audit is run in a browser by hand for phones, tablets and desktops.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const rule = (sel) => { const m = css.match(new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };

test('every card is capped to the window and scrolls inside itself, at every height', () => {
  const capRules = [...css.matchAll(/\n\s*\.panel\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  assert.match(capRules, /max-height:\s*calc\(100dvh/);
  assert.match(capRules, /overflow-y:\s*auto/);
  assert.match(capRules, /overscroll-behavior:\s*contain/);
});

test('cards respect the notch and home bar on all four sides', () => {
  const o = rule('.overlay');
  for (const side of ['top', 'right', 'bottom', 'left']) assert.match(o, new RegExp('safe-area-inset-' + side), side);
});

test('the run-over card keeps Play Again docked, and goes two-column on a short landscape screen', () => {
  const dead = html.slice(html.indexOf('id="ovDead"'), html.indexOf('id="ovSettings"'));
  assert.match(dead, /<div class="dock">\s*<button class="btn coral" id="btnAgain"/);
  assert.match(css, /orientation:\s*landscape\)\s*and\s*\(max-height:\s*560px\)[\s\S]*\.dead-cols\s*\{[^}]*grid-template-columns/);
});

test('Settings keeps Back docked and Pause keeps Resume docked', () => {
  assert.match(html, /<div class="dock"><button class="btn ghost" id="btnCloseSettings">/);
  assert.match(html, /<div class="dock top"><button class="btn" id="btnResume">/);
  assert.match(rule('.dock'), /position:\s*sticky/);
});

test('sliders get their own line on a narrow phone, and switches keep a full-size touch target', () => {
  assert.match(css, /max-width:\s*400px\)\s*\{\s*\.slider-row\s*\{[^}]*display:\s*grid/);
  assert.match(css, /pointer:\s*coarse\)\s*\{\s*\.toggle-row\s*\{\s*min-height:\s*48px/);
  // The switch itself (the thing with the click handler) reaches 48px: 28px track + 10px above and below.
  const sw = rule('.switch::before');
  assert.match(sw, /inset:\s*-10px\s+-6px/);
  assert.match(rule('.switch'), /height:\s*28px/);
});

test('the stylesheet is balanced, with no orphaned fragments', () => {
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'every { has its }');
  const slider = css.slice(css.indexOf('/* On a narrow phone the slider'), css.indexOf(".slider-row input[type='range'] {\n    -webkit"));
  assert.doesNotMatch(slider, /order:/, 'no flex ordering left behind from the grid layout');
});

test('one design language: shared tokens drive cards, buttons and motion', () => {
  const root = rule(':root');
  for (const t of ['--r-sm', '--r-lg', '--sp-2', '--fs-cap', '--fs-hero', '--ease-out', '--dur-2', '--line']) assert.match(root, new RegExp(t + ':'), t);
  assert.match(css, /\n\s*\.panel\s*\{[^}]*border-radius:\s*var\(--r-lg\)/);
  assert.match(css, /\.btn:active\s*\{[^}]*transform/);
  assert.match(css, /\.btn:disabled\s*\{/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.btn:hover/);
  // every card heading uses the shared type scale, not an inline size
  assert.doesNotMatch(html, /class="title-lg"[^>]*style="font-size/);
});

test('Pause keeps its title visible above the docked Resume button', () => {
  const r = css.match(/\.panel > \* \+ \.dock\.top\s*\{([^}]*)\}/);
  assert.ok(r, 'a dock under a title gets its own rule');
  assert.match(r[1], /top:\s*0/);
  assert.doesNotMatch(r[1], /margin-top:\s*calc\(-1/);
});

test('reduce motion switches off the card cascade as well as the slide', () => {
  assert.match(css, /body\.reduce-motion \.overlay\.in \.panel > \*\s*\{\s*animation:\s*none/);
});

test('phone on its side: the title card goes two-column and sits low, clear of the wordmark', () => {
  const land = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 560px)'));
  assert.match(land, /#ovAttract\s*\{\s*justify-content:\s*flex-end/);
  assert.match(land, /#ovAttract \.panel\s*\{[^}]*grid-template-columns/);
  assert.match(html, /<div class="attract-main">[\s\S]*id="btnPlay"[\s\S]*<div class="attract-side">[\s\S]*id="attractRow"/);
});

test('death card: eyebrow, hero score, stat tiles in the shared scale; Records and Room keep their key button docked', () => {
  const dead = html.slice(html.indexOf('id="ovDead"'), html.indexOf('id="ovSettings"'));
  assert.match(dead, /class="eyebrow">Run Over/);
  assert.match(dead, /id="deadStats" class="stat-grid"/);
  assert.match(css, /#deadScore\s*\{[^}]*font-size:\s*var\(--fs-hero\)/);
  assert.match(css, /\.stat-grid\s*\{[^}]*grid-template-columns/);
  assert.match(html, /<div class="dock"><button class="btn ghost" id="btnCloseTrophy">/);
  // A bottom-sticky dock must be the LAST row of its card, or later rows slide under it as they scroll into place.
  const room = html.slice(html.indexOf('id="ovRoom"'), html.indexOf('<!-- Run Together: join invite prompt -->'));
  assert.match(room, /<div class="dock">\s*<button class="btn" id="btnRoomPlay">Start Together<\/button>\s*<button class="btn ghost" id="btnRoomBack">Back<\/button>\s*<\/div>\s*<\/div>\s*<\/div>/);
});

test('rows rise in and are then released, and hover never overrides the pressed or disabled look', () => {
  const rise = css.match(/\.overlay\.in \.panel > :not\(\.dock\):not\(\.pulse\)\s*\{([^}]*)\}/);
  assert.ok(rise, 'the row animation skips the dock and any pulsing button');
  assert.match(rise[1], /rowRise[^;]*\bbackwards\b/);
  assert.doesNotMatch(rise[1], /\bboth\b/, 'a forwards fill would pin transform and defeat :active');
  for (const sel of ['.btn:hover', '.btn.ghost:hover', '.btn.coral:hover']) {
    assert.ok(css.includes(sel + ':not(:disabled):not(:active)'), sel + ' is limited to enabled, un-pressed buttons');
  }
});

test('the wordmark always fits the sky above the hero, whatever the window or however tall the card', () => {
  const { client, relay } = require('./harness.cjs');
  for (const [w, h] of [[1000, 450], [1280, 720], [1366, 768], [1920, 1080], [2560, 1080], [844, 390], [700, 420], [390, 844], [360, 640], [800, 1200]]) {
    const c = client(relay(), { width: w, height: h });
    try {
      c.run("G.mode = 'attract'");
      const k = c.run('view.h / window.innerHeight');
      // The card's top edge anywhere from "most of the screen" down to "barely any card" (CSS px).
      for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        c.run(`G.attractCardTop = ${h * frac * k}`);
        const m = JSON.parse(c.run('JSON.stringify(wordmarkMetrics())'));
        const ct = h * frac * k, top = m.cy - m.size * 0.55, bottom = m.cy + m.size * 0.55;
        assert.ok(top >= -0.5, `${w}x${h} card@${frac}: the mark is cut off the top (${top.toFixed(1)})`);
        if (m.size > 14.01) assert.ok(bottom <= ct - 14 - 62 + 0.5, `${w}x${h} card@${frac}: the mark runs into the hero (${bottom.toFixed(1)} > ${(ct - 76).toFixed(1)})`);
        assert.ok(m.size <= 68.01 && m.size >= 14);
      }
    } finally { c.close(); }
  }
});

test('safe-area insets are remembered per orientation, so an app resume that reports zero cannot drop the HUD under the clock', () => {
  const { client, relay } = require('./harness.cjs');
  const storage = new Map();
  const c = client(relay(), { width: 393, height: 852, storage });
  try {
    const probe = (vals) => { c.context.getComputedStyle = () => ({ paddingTop: vals[0] + 'px', paddingRight: vals[1] + 'px', paddingBottom: vals[2] + 'px', paddingLeft: vals[3] + 'px', getPropertyValue: () => '0' }); c.run('readSafeInsets()'); };
    probe([47, 0, 34, 0]);
    assert.deepEqual(JSON.parse(c.run('JSON.stringify([safeInset("top"), safeInset("bottom")])')), [47, 34]);
    probe([0, 0, 0, 0]);   // the app comes back from the background and iOS says nothing
    assert.deepEqual(JSON.parse(c.run('JSON.stringify([safeInset("top"), safeInset("bottom")])')), [47, 34], 'zero after a real reading is not believed');
    probe([59, 0, 34, 0]);
    assert.equal(c.run('safeInset("top")'), 59, 'a new real reading wins');
    assert.ok(storage.get('sm2.insets'), 'and it is kept for the next launch');
    // A fresh launch whose first reading is zero starts from the remembered value.
    const again = client(relay(), { width: 393, height: 852, storage });
    try {
      again.context.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', getPropertyValue: () => '0' });
      again.run('readSafeInsets()');
      assert.equal(again.run('safeInset("top")'), 59);
    } finally { again.close(); }
  } finally { c.close(); }
});
