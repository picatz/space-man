const test = require('node:test');
const { runAcceptance } = require('./arena-network-helper.cjs');

test('arena online UI: independent Chromium clients, real crypto, SIMULATED opaque relay', { timeout: 240000 }, async t => {
  await runAcceptance(t, { live: false });
});
