const test = require('node:test');
const relayHost = process.env.SPACE_MAN_RELAY_HOST;

// Explicit opt-in only. "default" selects shipped public-relay discovery;
// hostname[:port] selects an existing authorized relay. Never silently fall back
// to the simulated relay. Without opt-in this file does not load Playwright,
// open a browser/server or contact a network. No new service or secret is used.
test('racing LIVE relay: independent desktop, phone, spectator and late-player acceptance', {
  skip: !relayHost && 'Set SPACE_MAN_RELAY_HOST=default or hostname[:port] to opt in',
  timeout: 420000,
}, async t => {
  const { runAcceptance, validateRelayHost } = require('./race-network-helper.cjs');
  validateRelayHost(relayHost);
  await runAcceptance(t, {live:true,relayHost});
});
