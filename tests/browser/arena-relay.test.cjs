const test = require('node:test');
const relayHost = process.env.SPACE_MAN_RELAY_HOST;

// Explicit opt-in only. "default" uses the shipped relay discovery; a plain
// hostname overrides it. Neither live path falls back to the simulated relay. Without the environment variable this file does not
// load Playwright, launch a browser, start a server, or contact any network.
test('arena LIVE relay: independent desktop, phone, spectator and late-player acceptance', {
  skip: !relayHost && 'Set SPACE_MAN_RELAY_HOST=default or hostname[:port] to opt in',
  timeout: 240000,
}, async t => {
  const { runAcceptance, validateRelayHost } = require('./arena-network-helper.cjs');
  validateRelayHost(relayHost); // Fail malformed hostnames before Playwright loads.
  await runAcceptance(t, { live: true, relayHost });
});
