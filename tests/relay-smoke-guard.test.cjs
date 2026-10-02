const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const entry = path.join(__dirname, 'browser', 'relay.test.cjs');
function invoke(host) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // child is a fresh test runner, not this runner's worker
  // A developer's opt-in must never make the default offline suite use a relay.
  for (const key of Object.keys(env)) if (key.startsWith('SPACE_MAN_')) delete env[key];
  if (host !== undefined) env.SPACE_MAN_RELAY_HOST = host;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', entry], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test('browser smoke skips without explicit opt-in, even without Playwright installed', () => {
  const result = invoke();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /# SKIP Set SPACE_MAN_RELAY_HOST/);
});

for (const [host, message] of [
  ['wss://relay.example.com', /Use a relay hostname/],
  ['relay.example.com/derp', /Use a relay hostname/],
  ['relay.example.com:0', /Relay port must be between 1 and 65535/],
  ['relay.example.com:65536', /Relay port must be between 1 and 65535/],
]) test(`browser smoke rejects ${host} before loading Playwright`, () => {
  const result = invoke(host);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, message);
  assert.doesNotMatch(result.output, /Cannot find module|browserType.launch/);
});
