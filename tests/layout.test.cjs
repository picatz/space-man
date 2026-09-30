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
