'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

for (const key of [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'Home', 'Tab']) {
  test(`focused menu control owns ${JSON.stringify(key)} down and up`, t => {
    const c = client(relay()); t.after(() => c.close());
    const prevented = [];
    const control = { tagName: key.startsWith('Arrow') ? 'INPUT' : 'BUTTON', type: 'range', closest: selector => selector === '.overlay.show' ? {} : null };
    c.context.document.activeElement = control;
    c.context.__keyEvent = { key, target: control, preventDefault: () => prevented.push(key) };
    c.run("G.mode = 'attract'; input.jumpHeld = false; input.jumpPressed = false; onKey(__keyEvent, true); onKey(__keyEvent, false)");
    assert.deepEqual(prevented, [], 'native browser default is not cancelled, including Space keyup');
    assert.equal(c.run('G.mode'), 'attract');
    assert.equal(c.run('input.jumpHeld || input.jumpPressed'), false, 'menu key never queues a game jump');
  });
}
test('unfocused gameplay Space still jumps and releases', t => {
  const c = client(relay()); t.after(() => c.close());
  const prevented = [];
  c.context.document.activeElement = c.context.document.body;
  c.context.__keyEvent = { key: ' ', target: c.context.document.body, preventDefault: () => prevented.push(true) };
  c.run("G.mode = 'play'; input.jumpHeld = false; input.jumpPressed = false; onKey(__keyEvent, true)");
  assert.equal(c.run('input.jumpHeld && input.jumpPressed'), true);
  c.run('onKey(__keyEvent, false)');
  assert.equal(c.run('input.jumpHeld'), false);
  assert.equal(prevented.length, 2);
});

test('haptic fallback restores a real control when its hidden switch steals focus', t => {
  const c = client(relay()); t.after(() => c.close());
  const doc = c.context.document, hiddenSwitch = {}, label = doc.getElementById('hapLbl');
  let restored = 0;
  const control = { isConnected: true, focus(options) { assert.equal(options.preventScroll, true); restored++; doc.activeElement = control; } };
  doc.activeElement = control;
  label.click = () => { doc.activeElement = hiddenSwitch; };
  label.contains = node => node === hiddenSwitch;
  c.run("settings.haptics = true; settings.hapticsSaver = false; buzz('tap')");
  assert.equal(doc.activeElement, control);
  assert.equal(restored, 1);
});
test('haptic fallback does not replace a legitimate focus change', t => {
  const c = client(relay()); t.after(() => c.close());
  const doc = c.context.document, nextControl = {}, label = doc.getElementById('hapLbl');
  let restored = 0;
  doc.activeElement = { isConnected: true, focus() { restored++; } };
  label.click = () => { doc.activeElement = nextControl; };
  label.contains = () => false;
  c.run("settings.haptics = true; settings.hapticsSaver = false; buzz('tap')");
  assert.equal(doc.activeElement, nextControl);
  assert.equal(restored, 0);
});

test('haptic fallback blurs the hidden switch when nothing real had focus', t => {
  const c = client(relay()); t.after(() => c.close());
  const doc = c.context.document, label = doc.getElementById('hapLbl');
  let blurred = 0;
  const hiddenSwitch = { blur() { blurred++; doc.activeElement = doc.body; } };
  doc.activeElement = doc.body;
  label.click = () => { doc.activeElement = hiddenSwitch; };
  label.contains = node => node === hiddenSwitch;
  c.run("settings.haptics = true; settings.hapticsSaver = false; buzz('tap')");
  assert.equal(blurred, 1);
  assert.equal(doc.activeElement, doc.body);
});

function stubOverlay(c, id, items) {
  const el = c.context.document.getElementById(id);
  Object.assign(el, { querySelectorAll: () => items, contains: (n) => items.includes(n) });
  return el;
}
function item(doc, id) {
  return { id, disabled: false, tabIndex: 0, isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), focus() { doc.activeElement = this; }, click() { if (this.onclick) this.onclick(); } };
}

test('pause is a labelled modal dialog and the install chip is a button', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<div class="overlay" id="ovPause">\s*<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">/);
  assert.match(html, /<button type="button" class="install-chip" id="installChip"/);
});

test('keyboard pause lands on Resume and Tab wraps inside the pause card', t => {
  const c = client(relay()); t.after(() => c.close());
  const doc = c.context.document;
  const resume = item(doc, 'btnResume'), quit = item(doc, 'btnQuit');
  stubOverlay(c, 'ovPause', [resume, quit]);
  doc.activeElement = doc.body;
  c.run("startRun(); hideAllOverlays(); G.mode = 'play'; onKey({ key: 'Escape', target: document.body, preventDefault() {} }, true)");
  assert.equal(c.run('G.mode'), 'pause');
  assert.equal(doc.activeElement, resume, 'keyboard pause focuses the first control');
  let prevented = 0;
  quit.focus();
  c.context.__e = { key: 'Tab', shiftKey: false, target: quit, preventDefault: () => prevented++ };
  c.run('onKey(__e, true)');
  assert.equal(doc.activeElement, resume, 'Tab from the last control wraps');
  assert.equal(prevented, 1);
  c.context.__e = { key: 'Tab', shiftKey: true, target: resume, preventDefault: () => prevented++ };
  c.run('onKey(__e, true)');
  assert.equal(doc.activeElement, quit, 'Shift+Tab from the first control wraps back');
});

test('closing a sub-menu returns focus to the control that opened it', t => {
  const c = client(relay()); t.after(() => c.close());
  const doc = c.context.document;
  const settingsBtn = item(doc, 'btnSettings'), play = item(doc, 'btnPlay'), close = item(doc, 'btnCloseSettings');
  stubOverlay(c, 'ovAttract', [play, settingsBtn]);
  stubOverlay(c, 'ovSettings', [close]);
  c.run('showAttract()');
  settingsBtn.focus();
  c.run("openSettings('attract')");
  close.focus();
  Object.assign(doc.getElementById('btnCloseSettings'), { getClientRects: () => [1] });
  assert.equal(c.run('menuBack()'), true);
  assert.equal(doc.activeElement, settingsBtn);
});
