// The shared spectator layer (src/spectate.js): one dock, one set of gestures, every mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/spectate.js');

function fakeDoc() {
  const node = (tag) => ({
    tag, children: [], attrs: {}, dataset: {}, listeners: {}, hidden: false, disabled: false, textContent: '', id: '',
    append(...c) { this.children.push(...c); }, remove() { this.removed = true; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    click() { for (const fn of this.listeners.click || []) fn({ stopPropagation() {} }); },
  });
  const doc = { createElement: node, body: node('body') };
  doc.find = (id, n = doc.body) => n.id === id ? n : n.children.map((c) => doc.find(id, c)).find(Boolean);
  return doc;
}

test('cycle walks an ordered list both ways, wrapping, and starts at the front or back', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(S.cycle(ids, 'a', 1), 'b');
  assert.equal(S.cycle(ids, 'c', 1), 'a', 'wraps forward');
  assert.equal(S.cycle(ids, 'a', -1), 'c', 'wraps back');
  assert.equal(S.cycle(ids, 'gone', 1), 'a', 'nobody followed: next is the leader');
  assert.equal(S.cycle(ids, 'gone', -1), 'c', 'previous is the back of the field');
  assert.equal(S.cycle([], 'a', 1), null);
});

test('keys: arrows, Q/E and brackets switch, V toggles the wide view, browser chords pass through', () => {
  const k = (code, extra) => S.keyAction({ code, ...extra });
  assert.equal(k('ArrowLeft'), 'prev'); assert.equal(k('ArrowRight'), 'next');
  assert.equal(k('KeyQ'), 'prev'); assert.equal(k('KeyE'), 'next');
  assert.equal(k('BracketLeft'), 'prev'); assert.equal(k('BracketRight'), 'next');
  assert.equal(k('KeyV'), 'overview');
  assert.equal(k('KeyV', { ctrlKey: true }), null, 'Ctrl+V is paste');
  assert.equal(k('ArrowRight', { metaKey: true }), null);
  assert.equal(k('Space'), null);
});

test('controller: bumpers and d-pad switch once per press, Y toggles, a press held over from play is ignored', () => {
  const pad = (...down) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) });
  const r = S.padReader();
  assert.equal(r.read(pad(5)), null, 'RB already held when watching began');
  assert.equal(r.read(pad(5)), null);
  assert.equal(r.read(pad()), null);
  assert.equal(r.read(pad(5)), 'next');
  assert.equal(r.read(pad(5)), null, 'holding moves one target');
  assert.equal(r.read(pad(4)), 'prev');
  assert.equal(r.read(pad()), null);
  assert.equal(r.read(pad(15)), 'next'); assert.equal(r.read(pad()), null);
  assert.equal(r.read(pad(14)), 'prev'); assert.equal(r.read(pad()), null);
  assert.equal(r.read(pad(3)), 'overview');
  assert.equal(r.read(null), null, 'a pulled controller resets');
  assert.equal(r.read(pad(3)), null, 'and the next one starts neutral');
});

test('the hint speaks the language of the hand on the device', () => {
  assert.match(S.hintFor('touch', 3), /Swipe/);
  assert.match(S.hintFor('keys', 3), /←/);
  assert.match(S.hintFor('pad', 3), /LB RB/);
  assert.match(S.hintFor('pad', 1), /Only one/);
  assert.match(S.hintFor('touch', 0), /Nobody/);
});

test('the dock shows who is watched, wires its buttons, and only writes what changed', () => {
  const doc = fakeDoc(), calls = [];
  const bar = S.createBar({
    doc, prefix: 'raceWatch', mode: 'race',
    onPrev: () => calls.push('prev'), onNext: () => calls.push('next'), onOverview: () => calls.push('overview'),
    actions: [{ id: 'join', label: 'Race next', primary: true, onClick: () => calls.push('join') }, { id: 'leave', label: 'Leave', onClick: () => calls.push('leave') }],
  });
  assert.equal(bar.el.hidden, true, 'hidden until a mode says it is watching');
  assert.equal(bar.el.dataset.mode, 'race');
  bar.update({ active: true, name: 'NOVA', detail: '2nd of 5 · Lap 2/3', count: 4, inputKind: 'keys', actions: { leave: { hidden: true } } });
  assert.equal(bar.el.hidden, false);
  assert.equal(doc.find('raceWatchName').textContent, 'NOVA');
  for (const id of ['raceWatchPrevious', 'raceWatchNext', 'raceWatchOverview', 'raceWatchJoin']) doc.find(id).click();
  assert.deepEqual(calls, ['prev', 'next', 'overview', 'join']);
  assert.equal(doc.find('raceWatchLeave').hidden, true);
  assert.equal(doc.find('raceWatchOverview').getAttribute('aria-pressed'), 'false');
  const live = bar.el.children.find((c) => c.attrs['aria-live']);
  assert.equal(live.textContent, 'Watching NOVA', 'screen readers hear the switch');
  live.textContent = 'cleared';
  bar.update({ active: true, name: 'NOVA', detail: '1st of 5 · Lap 2/3', count: 4, overview: true });
  assert.equal(live.textContent, 'cleared', 'same target: announced once, not every frame');
  assert.equal(doc.find('raceWatchOverview').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.find('raceWatchOverview').textContent, 'Follow');
  bar.update({ active: true, name: 'SOLO', count: 1 });
  assert.equal(doc.find('raceWatchNext').disabled, true, 'nothing to switch to');
  bar.update({ active: false });
  assert.equal(bar.el.hidden, true);
});

test('a swipe across the play surface switches; taps, vertical drags and slow drags do not', () => {
  const doc = fakeDoc(), surface = doc.createElement('canvas'), seen = [];
  let enabled = true;
  S.bindSwipe(surface, { enabled: () => enabled, onPrev: () => seen.push('prev'), onNext: () => seen.push('next') });
  const swipe = (dx, dy, ms = 200) => {
    for (const fn of surface.listeners.pointerdown) fn({ clientX: 200, clientY: 300, timeStamp: 0, pointerId: 1, target: surface });
    for (const fn of surface.listeners.pointerup) fn({ clientX: 200 + dx, clientY: 300 + dy, timeStamp: ms, pointerId: 1 });
  };
  swipe(-120, 10); swipe(120, -12); swipe(10, 0); swipe(60, 140); swipe(-120, 0, 2000);
  assert.deepEqual(seen, ['next', 'prev']);
  enabled = false; swipe(-120, 0);
  assert.deepEqual(seen, ['next', 'prev'], 'off while not watching');
});
