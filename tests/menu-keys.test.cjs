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
