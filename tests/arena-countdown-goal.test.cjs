'use strict';
// New pilots stare at the countdown: it must state the goal for every format,
// and the GO beat must teach what the damage percentage means.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/arena-ui.js'), 'utf8');

test('countdown names the goal for every format and GO teaches damage', () => {
  const goals = /const COUNTDOWN_GOAL = \{([^}]*)\}/.exec(source);
  assert.ok(goals, 'COUNTDOWN_GOAL table');
  for (const format of ['duel', 'ffa', 'teams']) assert.match(goals[1], new RegExp(format + ": '[A-Z -]+·[^']+'"));
  assert.match(source, /HIGHER % FLIES FARTHER/);
  assert.ok(source.indexOf('const COUNTDOWN_GOAL') < source.indexOf('function updateHud'), 'declared before use');
});
