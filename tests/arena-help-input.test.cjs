'use strict';
// The lobby's How to play shows only the current input's hints: every
// paragraph is tagged, keyboard and 2-player text is keys-only, and the
// drawer is closed whenever the lobby is shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/arena-ui.js'), 'utf8');

test('help paragraphs are tagged per input and hidden by default', () => {
  assert.match(source, /tip\('keys', 'KEYBOARD/);
  assert.match(source, /tip\('pad', 'CONTROLLER/);
  assert.match(source, /tip\('touch', 'TOUCH/);
  assert.match(source, /tip\('keys', '2 PLAYERS/);
  assert.match(source, /\.arena-help-grid p\[data-help\]\{display:none/);
  assert.match(source, /body\[data-input=touch\] \.arena-help-grid p\[data-help=touch\]\{display:block\}/);
  assert.match(source, /\.arena-controls-help'\)\.open = false/);
});
