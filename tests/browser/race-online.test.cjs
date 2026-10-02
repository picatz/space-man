const test = require('node:test');
const { runAcceptance, browserName } = require('./race-network-helper.cjs');

test(`racing online UI: independent ${browserName()} clients, genuine three-lap races, SIMULATED opaque relay`, {
  timeout: 360000,
}, async t => {
  await runAcceptance(t, {live:false});
});
