'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const publisher = require('../scripts/publish-pages.cjs');

const MAIN = 'a'.repeat(40), FIRST = 'b'.repeat(40), SECOND = 'c'.repeat(40);
function pull(number = 10, sha = FIRST, patch = {}) {
  return { number, state: 'open', user: { login: 'picatz' },
    head: { sha, repo: { full_name: 'picatz/space-man' } },
    base: { ref: 'main', repo: { full_name: 'picatz/space-man' } }, ...patch };
}
function passed(item, patch = {}) {
  return { name: publisher.testJobName(item), status: 'completed', conclusion: 'success', ...patch };
}
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-publisher-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('reconciliation accepts only open picatz-authored same-repository PR heads targeting main', () => {
  const disallowed = [
    pull(2, FIRST, { user: { login: 'someone-else' } }),
    pull(3, FIRST, { head: { sha: FIRST, repo: { full_name: 'someone/space-man' } } }),
    pull(4, FIRST, { head: { sha: FIRST, repo: null } }),
    pull(5, FIRST, { state: 'closed' }),
    pull(6, FIRST, { base: { ref: 'other', repo: { full_name: 'picatz/space-man' } } }),
    pull(7, FIRST, { base: { ref: 'main', repo: { full_name: 'other/space-man' } } }),
    pull(8, 'abcdef'), pull(9, 'A'.repeat(40)), pull(-1), pull('../escape'),
  ];
  assert.ok(disallowed.every(item => !publisher.trustedPull(item)));
  const plan = publisher.makePlan(MAIN, [...disallowed, pull(20, SECOND), pull(10)]);
  assert.deepEqual(plan.previews.map(item => item.number), [10, 20]);
  assert.equal(plan.main.label, 'main');
  assert.equal(plan.previews[0].sha, FIRST);
  assert.throws(() => publisher.makePlan(MAIN, [pull(), pull()]), /Duplicate/);
  assert.throws(() => publisher.makePlan('../bad', []), /main SHA/);
});

test('plan validation rejects path/label injection and duplicate identities', () => {
  const plan = publisher.makePlan(MAIN, [pull()]);
  assert.equal(publisher.validatePlan(plan), plan);
  for (const patch of [ { sha: 'b'.repeat(39) }, { number: '../10' }, { label: 'main' } ]) {
    assert.throws(() => publisher.validatePlan({ ...plan, previews: [{ ...plan.previews[0], ...patch }] }), /Invalid/);
  }
  assert.throws(() => publisher.validatePlan({ ...plan, repository: 'other/repo' }), /Invalid/);
  assert.throws(() => publisher.validatePlan({ ...plan, previews: [...plan.previews, ...plan.previews] }), /Duplicate/);
});

test('all still-current passing PRs survive a reconcile regardless of triggering PR', () => {
  const pulls = [pull(10), pull(20, SECOND)];
  const plan = publisher.makePlan(MAIN, pulls);
  const selection = publisher.selectPublishable(plan, MAIN, pulls, [plan.main, ...plan.previews].map(item => passed(item)));
  assert.deepEqual(selection.included.map(item => item.number), [10, 20]);
  assert.deepEqual(selection.omitted, []);
});

test('failed, cancelled, missing and duplicate exact-head job results never publish', () => {
  const plan = publisher.makePlan(MAIN, [pull()]);
  for (const bad of [[], [passed(plan.previews[0], { conclusion: 'failure' })],
    [passed(plan.previews[0], { conclusion: 'cancelled' })],
    [passed(plan.previews[0], { status: 'in_progress' })],
    [passed(plan.previews[0]), passed(plan.previews[0])],
    [passed({ ...plan.previews[0], sha: SECOND })]]) {
    const selection = publisher.selectPublishable(plan, MAIN, [pull()], [passed(plan.main), ...bad]);
    assert.equal(selection.included.length, 0);
    assert.match(selection.omitted[0].reason, /did not pass/);
  }
});

test('failing PR tests do not block passing PRs or production; main failure is fail-closed', () => {
  const pulls = [pull(10), pull(20, SECOND)];
  const plan = publisher.makePlan(MAIN, pulls);
  const jobs = [passed(plan.main), passed(plan.previews[0], { conclusion: 'failure' }), passed(plan.previews[1])];
  const selection = publisher.selectPublishable(plan, MAIN, pulls, jobs);
  assert.deepEqual(selection.included.map(item => item.number), [20]);
  assert.throws(() => publisher.selectPublishable(plan, MAIN, pulls, jobs.slice(1)), /Production offline tests/);
  assert.throws(() => publisher.selectPublishable(plan, SECOND, pulls, jobs), /Main changed/);
});

test('closed, superseded and newly ineligible heads are removed; newly opened heads wait for testing', () => {
  const plan = publisher.makePlan(MAIN, [pull(10), pull(20, SECOND), pull(30, SECOND)]);
  const current = [pull(10, SECOND), pull(30, SECOND, { user: { login: 'other' } }), pull(40)];
  const jobs = [plan.main, ...plan.previews].map(item => passed(item));
  const selection = publisher.selectPublishable(plan, MAIN, current, jobs);
  assert.equal(selection.included.length, 0);
  assert.equal(selection.omitted.length, 3);
});

test('API pagination preserves PRs and uses read-only authenticated repository routes', async () => {
  const requests = [];
  const api = publisher.createApi('example-read-only-token', async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => requests.length === 1 ? Array.from({ length: 100 }, (_, index) => index) : [100] };
  });
  const items = await publisher.allPages(api, '/repos/picatz/space-man/pulls?state=open');
  assert.equal(items.length, 101);
  assert.match(requests[1].url, /&per_page=100&page=2$/);
  assert.equal(requests[0].options.method, undefined);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer example-read-only-token');
  await assert.rejects(api('/repos/other/repo/pulls'), /Unexpected API route/);
  const failed = publisher.createApi('test', async () => ({ ok: false, status: 403 }));
  await assert.rejects(failed('/repos/picatz/space-man/pulls'), /403/);
});

test('job lookup pagination is scoped to one workflow run and attempt', async () => {
  const seen = [];
  const jobs = await publisher.allPages(async route => {
    seen.push(route);
    return { jobs: [{ name: 'one' }] };
  }, '/repos/picatz/space-man/actions/runs/123/attempts/2/jobs', 'jobs');
  assert.equal(jobs.length, 1);
  assert.deepEqual(seen, ['/repos/picatz/space-man/actions/runs/123/attempts/2/jobs?per_page=100&page=1']);
});

test('assembly preserves production and concurrent exact source+builder paths without executing PR scripts', async t => {
  const root = temporary(t), trusted = path.join(root, 'trusted'), output = path.join(root, 'site');
  fs.mkdirSync(trusted);
  const pulls = [pull(10), pull(20, SECOND)];
  const plan = publisher.makePlan(MAIN, pulls);
  const selection = { included: plan.previews, omitted: [] };
  const calls = [];
  const manifest = await publisher.assemble(plan, selection, {
    trusted, output, base: 'https://spacemangame.online/',
    copyProduction(source, destination) {
      assert.equal(source, trusted);
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'index.html'), 'production from main');
      fs.writeFileSync(path.join(destination, 'CNAME'), 'spacemangame.online');
    },
    checkout(sha, directory) { calls.push(sha); return directory; },
    build(source, destination, item) {
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'index.html'), `preview ${item.sha}`);
    },
  });
  assert.deepEqual(calls, [FIRST, SECOND]);
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'production from main');
  assert.equal(fs.readFileSync(path.join(output, 'CNAME'), 'utf8'), 'spacemangame.online');
  for (const item of plan.previews) {
    assert.equal(fs.readFileSync(path.join(output, 'pr', String(item.number), item.sha, MAIN, 'index.html'), 'utf8'), `preview ${item.sha}`);
  }
  assert.equal(manifest.previews[0].url, `https://spacemangame.online/pr/10/${FIRST}/${MAIN}/`);
  assert.equal(manifest.previews[0].buildSha, MAIN);
  assert.ok(fs.existsSync(path.join(output, '.nojekyll')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'pr', 'previews.json'), 'utf8')), manifest);
  assert.match(fs.readFileSync(path.join(output, 'pr', 'index.html'), 'utf8'), /not permanent archives/);
});

test('incompatible PR build is omitted without leaving partial content or losing other previews', async t => {
  const root = temporary(t), output = path.join(root, 'site');
  const plan = publisher.makePlan(MAIN, [pull(10), pull(20, SECOND)]);
  const manifest = await publisher.assemble(plan, { included: plan.previews, omitted: [] }, {
    trusted: root, output, base: 'https://spacemangame.online/',
    copyProduction(_source, destination) { fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'index.html'), 'main'); },
    checkout(_sha, directory) { return directory; },
    build(_source, destination, item) {
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'index.html'), 'partly built');
      if (item.number === 10) throw new Error('missing preview-aware runtime');
    },
  });
  assert.deepEqual(manifest.previews.map(item => item.number), [20]);
  assert.deepEqual(manifest.omitted.map(item => item.number), [10]);
  assert.equal(fs.existsSync(path.join(output, 'pr', '10')), false);
});

test('CLI is default-off and never makes an API request when disabled', () => {
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../scripts/publish-pages.cjs'), 'plan'], {
    env: { ...process.env, SPACE_MAN_PREVIEWS_ENABLED: '', GITHUB_TOKEN: '', GITHUB_REPOSITORY: 'picatz/space-man' }, stdio: 'pipe',
  }), error => /Pages previews are disabled/.test(error.stderr.toString()));
});

test('workflow trust boundaries stay explicit and deploy never executes repository code', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/pr-previews.yml'), 'utf8');
  assert.match(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /workflows: \[Regression tests\]/);
  assert.match(workflow, /SPACE_MAN_PREVIEWS_ENABLED == 'true'/);
  assert.match(workflow, /group: space-man-pages\s+cancel-in-progress: false/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /name: Offline checks \$\{\{ matrix.label \}\} \$\{\{ matrix.sha \}\}/);
  const testJob = workflow.split('\n  test:')[1].split('\n  assemble:')[0];
  assert.match(testJob, /ref: \$\{\{ matrix.sha \}\}/);
  assert.match(testJob, /persist-credentials: false/);
  assert.doesNotMatch(testJob, /: write|secrets\.|upload-artifact|cache:/);
  const assemble = workflow.split('\n  assemble:')[1].split('\n  deploy:')[0];
  assert.match(assemble, /ref: \$\{\{ needs.discover.outputs.main_sha \}\}/);
  assert.match(assemble, /actions: read/);
  assert.doesNotMatch(assemble, /: write/);
  const deploy = workflow.split('\n  deploy:')[1];
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(deploy, /uses: actions\/checkout|\n\s+run:|contents: write|pull-requests: write/);
});

test('real trusted builder receives both exact SHAs and ignores PR-provided build scripts', async t => {
  const root = temporary(t), source = path.join(root, 'pr-source'), output = path.join(root, 'site');
  const trusted = path.resolve(__dirname, '..');
  const { copyProduction } = require('../scripts/build-preview.cjs');
  await copyProduction(trusted, source);
  fs.mkdirSync(path.join(source, 'scripts'));
  const sentinel = path.join(root, 'untrusted-script-executed');
  fs.writeFileSync(path.join(source, 'scripts', 'build-preview.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'unsafe');`);
  const plan = publisher.makePlan(MAIN, [pull()]);
  const manifest = await publisher.assemble(plan, { included: plan.previews, omitted: [] }, {
    trusted, output, checkout() { return source; },
  });
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(manifest.previews.length, 1);
  const built = path.join(output, 'pr', '10', FIRST, MAIN);
  const metadata = JSON.parse(fs.readFileSync(path.join(built, 'preview-build.json'), 'utf8'));
  assert.equal(metadata.sha, FIRST);
  assert.equal(metadata.buildSha, MAIN);
  assert.equal(metadata.basePath, `/pr/10/${FIRST}/${MAIN}/`);
  assert.equal(fs.existsSync(path.join(built, 'scripts')), false);
  assert.equal(fs.existsSync(path.join(built, 'service-worker.js')), false);
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), fs.readFileSync(path.join(trusted, 'index.html'), 'utf8'));
});

test('source Git ignores inherited config, filters, fsmonitor, credentials and prompts', () => {
  const clean = publisher.gitEnvironment({ PATH: '/usr/bin', HOME: '/home/runner',
    GIT_CONFIG_GLOBAL: '/attacker/config', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'filter.evil.smudge',
    GIT_CONFIG_VALUE_0: 'execute-me', GIT_CONFIG: '/attacker/config', GIT_DIR: '/attacker/.git',
    GIT_WORK_TREE: '/attacker', GITHUB_TOKEN: 'read-only-token', GH_TOKEN: 'another-token', GIT_TERMINAL_PROMPT: '1' });
  assert.equal(clean.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(clean.GIT_CONFIG_SYSTEM, '/dev/null');
  assert.equal(clean.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(clean.GIT_ATTR_NOSYSTEM, '1');
  assert.equal(clean.GIT_TERMINAL_PROMPT, '0');
  assert.equal(clean.GIT_LFS_SKIP_SMUDGE, '1');
  for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG',
    'GIT_DIR', 'GIT_WORK_TREE', 'GITHUB_TOKEN', 'GH_TOKEN']) assert.equal(clean[key], undefined);
  assert.equal(clean.PATH, '/usr/bin');
  const script = fs.readFileSync(path.join(__dirname, '../scripts/publish-pages.cjs'), 'utf8');
  for (const setting of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.attributesFile=/dev/null',
    'filter.lfs.process=', 'filter.lfs.smudge=', 'filter.lfs.required=false']) assert.ok(script.includes(setting));
});

test('aggregate cap omits an oversized preview while production and another preview survive', async t => {
  const root = temporary(t), output = path.join(root, 'site');
  const plan = publisher.makePlan(MAIN, [pull(10), pull(20, SECOND)]);
  const manifest = await publisher.assemble(plan, { included: plan.previews, omitted: [] }, {
    trusted: root, output, base: 'https://spacemangame.online/', byteLimit: 1024 * 1024 + 50,
    copyProduction(_source, destination) { fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'index.html'), 'main'); },
    checkout(_sha, directory) { return directory; },
    build(_source, destination, item) {
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'index.html'), item.number === 10 ? 'x'.repeat(51) : 'small');
    },
  });
  assert.deepEqual(manifest.previews.map(item => item.number), [20]);
  assert.deepEqual(manifest.omitted.map(item => item.number), [10]);
  assert.equal(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), 'main');
  assert.equal(fs.existsSync(path.join(output, 'pr', '10')), false);
  assert.ok(publisher.directoryBytes(output) < 1024 * 1024 + 50);
  assert.equal(publisher.SITE_BYTES_LIMIT, 200 * 1024 * 1024);
});

test('artifact byte audit rejects symlinks and hardlinks before official uploader dereferences them', t => {
  const root = temporary(t), output = path.join(root, 'site');
  fs.mkdirSync(output);
  const external = path.join(root, 'outside');
  fs.writeFileSync(external, 'must not be uploaded');
  fs.symlinkSync(external, path.join(output, 'bad'));
  assert.throws(() => publisher.directoryBytes(output), /symlinks/);
  fs.rmSync(path.join(output, 'bad'));
  fs.linkSync(external, path.join(output, 'bad'));
  assert.throws(() => publisher.directoryBytes(output), /non-hardlinked/);
});

test('source checkout uses only fixed public remote and exact SHA with hardened Git invocation', t => {
  const root = temporary(t), bin = path.join(root, 'bin'), log = path.join(root, 'git-calls.jsonl');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\n` +
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2),env:process.env})+'\\n');\n` +
    `if(process.argv.includes('rev-parse'))process.stdout.write(${JSON.stringify(FIRST)});\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const saved = { PATH: process.env.PATH, GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
  try {
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'filter.custom.smudge';
    process.env.GIT_CONFIG_VALUE_0 = 'do-not-execute';
    const directory = path.join(root, 'source');
    assert.equal(publisher.checkoutSource(FIRST, directory), directory);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.ok(call.args.includes('core.fsmonitor=false'));
    assert.ok(call.args.includes('filter.lfs.process='));
    assert.equal(call.env.GIT_CONFIG_COUNT, undefined);
    assert.equal(call.env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(call.env.GIT_LFS_SKIP_SMUDGE, '1');
    assert.equal(call.env.GITHUB_TOKEN, undefined);
  }
  const fetch = calls.find(call => call.args.includes('fetch'));
  assert.deepEqual(fetch.args.slice(-6), ['fetch', '--quiet', '--depth=1', '--no-tags', 'https://github.com/picatz/space-man.git', FIRST]);
});
