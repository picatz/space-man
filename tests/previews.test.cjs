const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { client, relay } = require('./harness.cjs');
const { buildPreview, copyProduction } = require('../scripts/build-preview.cjs');
const ROOT = path.resolve(__dirname, '..');
const SHA = 'a'.repeat(40), BUILDER = 'b'.repeat(40);
const identity = (pr = 27, sha = SHA, buildSha = BUILDER) => ({ schema: 1, pr, sha, buildSha, basePath: `/pr/${pr}/${sha}/${buildSha}/` });

async function tmp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-man-preview-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('preview packager pins source and builder, keeps relative assets, and omits PWA/service-worker registration assets', async (t) => {
  const dir = await tmp(t), output = path.join(dir, 'preview');
  const info = await buildPreview({ source: ROOT, output, pr: 27, sha: SHA, buildSha: BUILDER });
  assert.deepEqual(info, identity());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'preview-build.json'))), info);
  const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /name="space-man-preview"/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.doesNotMatch(html, /<link\s+rel="manifest"/);
  assert.match(html, /<script src="src\/build.js">/);
  assert.equal(await fs.readFile(path.join(output, 'src/net.js'), 'utf8'), await fs.readFile(path.join(ROOT, 'src/net.js'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json')));
  assert.equal(manifest.id, info.basePath);
  assert.equal(manifest.start_url, './');
  for (const name of ['service-worker.js', 'CNAME', '.git', '.github', 'tests', 'scripts']) {
    await assert.rejects(fs.access(path.join(output, name)), { code: 'ENOENT' });
  }
  const second = path.join(dir, 'second');
  await buildPreview({ source: ROOT, output: second, pr: 27, sha: SHA, buildSha: BUILDER });
  assert.equal(await fs.readFile(path.join(second, 'index.html'), 'utf8'), html, 'same inputs yield deterministic metadata');
});

test('production package preserves game files and excludes repository/test internals', async (t) => {
  const dir = await tmp(t), output = path.join(dir, 'production');
  await copyProduction(ROOT, output);
  for (const file of ['index.html', 'service-worker.js', 'CNAME']) {
    assert.equal(await fs.readFile(path.join(output, file), 'utf8'), await fs.readFile(path.join(ROOT, file), 'utf8'));
  }
  for (const file of ['.git', '.github', 'tests', 'scripts', 'preview-build.json']) {
    await assert.rejects(fs.access(path.join(output, file)), { code: 'ENOENT' });
  }
});

test('preview packager rejects malformed identities, symlinks, unexpected paths, and nonempty outputs', async (t) => {
  const dir = await tmp(t), source = path.join(dir, 'source');
  await copyProduction(ROOT, source);
  const make = (extra = {}) => buildPreview({ source, output: path.join(dir, 'out'), pr: 27, sha: SHA, buildSha: BUILDER, ...extra });
  await assert.rejects(make({ pr: '../1' }), /positive PR/);
  await assert.rejects(make({ sha: 'main' }), /commit SHA/);
  await assert.rejects(make({ buildSha: 'main' }), /commit SHA/);
  await fs.rm(path.join(source, 'src/net.js'));
  await fs.symlink(path.join(ROOT, 'src/net.js'), path.join(source, 'src/net.js'));
  await assert.rejects(make(), /regular static/);
  await fs.rm(path.join(dir, 'out'), { recursive: true, force: true });
  await fs.rm(path.join(source, 'src/net.js'));
  await fs.writeFile(path.join(source, 'src/net.js'), '');
  await fs.writeFile(path.join(source, 'src/unexpected.cjs'), 'throw Error("never executed")');
  await assert.rejects(make(), /Unexpected static path/);
  await assert.rejects(make(), /Output must be empty/);
});

test('preview saves, directory cache, and tab resume state cannot overwrite production or another build', (t) => {
  const storage = new Map([['sm2.best', '999'], ['highScores', '[999]']]);
  const session = new Map([['sm2.resume', 'production-session']]);
  const hub = relay(), p = identity(), other = identity(27, 'c'.repeat(40));
  const a = client(hub, { preview: p, pathname: p.basePath, storage, session });
  const b = client(hub, { preview: other, pathname: other.basePath, storage, session });
  t.after(() => { a.close(); b.close(); });
  a.run('saveJSON(LS.best, 42); sessionStorage.setItem(RESUME_KEY, "preview-session")');
  assert.equal(a.run('loadJSON(LS.best, 0)'), 42);
  assert.equal(b.run('loadJSON(LS.best, 0)'), 0);
  assert.equal(storage.get('sm2.best'), '999');
  assert.equal(session.get('sm2.resume'), 'production-session');
  assert.notEqual(a.run('RESUME_KEY'), b.run('RESUME_KEY'));
  assert.notEqual(a.run('SpaceManRelayDir.CACHE_KEY'), b.run('SpaceManRelayDir.CACHE_KEY'));
  assert.match(a.run('SpaceManRelayDir.CACHE_KEY'), new RegExp(SHA));
  assert.equal(a.run('JSON.stringify(loadJSON("highScores", []))'), '[]', 'never migrate production history into a preview');
});

test('preview links retain both pinned revisions and reject codes or another build before networking', (t) => {
  const p = identity(), hub = relay();
  const c = client(hub, { preview: p, pathname: p.basePath });
  const production = client(hub);
  t.after(() => { c.close(); production.close(); });
  const url = 'https://space.test' + p.basePath + '#j=example';
  assert.equal(c.run('appBaseUrl()'), 'https://space.test' + p.basePath);
  const error = (s) => c.context.SpaceManBuild.inviteError(s);
  assert.equal(error(url), '');
  assert.match(error('ORD-COMET-42'), /full invite link/);
  assert.match(error('#j=example'), /full invite link/);
  assert.match(error(url.replace(SHA, 'c'.repeat(40))), /exact preview/);
  assert.match(error(url.replace(BUILDER, 'd'.repeat(40))), /exact preview/);
  assert.match(error(url.replace('space.test', 'other.test')), /exact preview/);
  assert.match(production.context.SpaceManBuild.inviteError(url), /Open that preview/);
  c.elements.get('joinInput').value = 'ORD-COMET-42';
  c.run('submitJoin()');
  assert.match(c.elements.get('joinHint').textContent, /full invite link/);
  assert.equal(c.net.active, false);
});

test('wrong-path or unstamped preview navigation fails closed before game storage writes', () => {
  const storage = new Map(), p = identity();
  assert.throws(() => client(relay(), { preview: p, pathname: '/', storage }), /wrong URL/);
  assert.equal(storage.size, 0);
  assert.throws(() => client(relay(), { pathname: p.basePath, storage }), /production cache intercepted/);
  assert.equal(storage.size, 0);
});

test('preview registration never installs a service worker', (t) => {
  const p = identity(), c = client(relay(), { preview: p, pathname: p.basePath, navigator: { serviceWorker: {} } });
  t.after(() => c.close());
  assert.equal(c.run('swu.reg'), null);
});

test('preview hosts publish only exact-build links, including after restoring the room', async (t) => {
  const p = identity(), c = client(relay(), { preview: p, pathname: p.basePath });
  t.after(() => c.close());
  c.run("G.cosmetics.callsign = [0, 0]");
  await c.run('openRoomFlow()');
  assert.equal(c.net.active, true);
  assert.equal(c.net.info().joinCode, '');
  assert.equal(c.net._n1.session().codeRelay, null);
  assert.equal(c.elements.get('roomCodeBar').style.display, 'none');
  assert.ok(c.net.info().link.startsWith('https://space.test' + p.basePath + '#j='));
  const token = c.net.resumeToken();
  c.net.leave();
  await c.context.SpaceManNet.openRoom({ resume: token, code: false, baseUrl: 'https://space.test' + p.basePath });
  assert.equal(c.net.info().joinCode, '');
  assert.equal(c.net._n1.session().codeRelay, null);
});

test('preview identity validation and payload parsing use the same URL, not unrelated pasted fragments', (t) => {
  const p = identity(), c = client(relay(), { preview: p, pathname: p.basePath }), production = client(relay());
  t.after(() => { c.close(); production.close(); });
  const real = 'd'.repeat(80), decoy = 'c'.repeat(80);
  const url = 'https://space.test' + p.basePath + '#j=' + real;
  const resolved = c.context.SpaceManBuild.resolveJoin('#j=' + decoy + ' ' + url);
  assert.equal(resolved.error, '');
  assert.equal(c.net.parseJoin(resolved.value).payload, real);
  assert.match(c.context.SpaceManBuild.resolveJoin(url + ' https://space.test/#j=' + decoy).error, /exact preview/);
  assert.match(production.context.SpaceManBuild.resolveJoin('https://space.test/#j=' + decoy + ' ' + url).error, /Open that preview/);
});

test('preview metadata stamping accepts attributed/uppercase head tags and rejects missing or duplicate heads', async (t) => {
  const dir = await tmp(t), source = path.join(dir, 'source');
  await copyProduction(ROOT, source);
  const html = await fs.readFile(path.join(source, 'index.html'), 'utf8');
  for (const [name, head] of [['attributes', '<head lang="en">'], ['uppercase', '<HEAD data-title="a > b">']]) {
    await fs.writeFile(path.join(source, 'index.html'), html.replace('<head>', head));
    const output = path.join(dir, name);
    await buildPreview({ source, output, pr: 27, sha: SHA, buildSha: BUILDER });
    assert.match(await fs.readFile(path.join(output, 'index.html'), 'utf8'), /name="space-man-preview"/);
  }
  for (const [name, head] of [['missing', ''], ['duplicate', '<head><head>']]) {
    await fs.writeFile(path.join(source, 'index.html'), html.replace('<head>', head));
    await assert.rejects(buildPreview({ source, output: path.join(dir, name), pr: 27, sha: SHA, buildSha: BUILDER }), /exactly one head/);
  }
});

test('preview identity uses the shared compact status rail and keeps full revisions accessible', (t) => {
  const p = identity(), c = client(relay(), { preview: p, pathname: p.basePath });
  t.after(() => c.close());
  const rail = c.elements.get('gameStatusRail'), badge = rail.children[0];
  assert.equal(badge.id, 'previewBuild');
  assert.equal(badge.className, 'game-status');
  assert.equal(badge.textContent, 'PREVIEW · PR #27 · aaaaaaa');
  assert.equal(badge.attrs.role, 'status');
  assert.ok(badge.attrs['aria-label'].includes(p.sha));
  assert.ok(badge.attrs['aria-label'].includes(p.buildSha));
  assert.equal(c.context.document.body.children.includes(badge), false, 'no independent fixed corner overlay');
});

test('shared status rail reserves CSS and scaled HUD space without persisting browser chrome', (t) => {
  for (const [width, height, hardware, visible] of [
    [390, 844, [47, 0, 34, 0], { offsetTop: 52, offsetLeft: 0, width: 390, height: 680 }],
    [844, 390, [0, 47, 21, 47], { offsetTop: 24, offsetLeft: 0, width: 844, height: 260 }],
  ]) {
    const p = identity(), storage = new Map();
    const c = client(relay(), { width, height, preview: p, pathname: p.basePath, storage, hash: '#shot=play&touch=1' });
    t.after(() => c.close());
    c.elements.get('gameStatusRail').offsetHeight = 20;
    c.context.visualViewport = visible;
    c.context.getComputedStyle = () => ({ paddingTop: hardware[0] + 'px', paddingRight: hardware[1] + 'px', paddingBottom: hardware[2] + 'px', paddingLeft: hardware[3] + 'px', getPropertyValue: () => '0' });
    const tokens = {};
    c.context.document.documentElement.style.setProperty = (key, value) => { tokens[key] = value; };
    c.run('readSafeInsets(); render(0)');
    const top = Math.max(hardware[0], visible.offsetTop), bottom = Math.max(hardware[2], height - visible.offsetTop - visible.height);
    assert.equal(c.run('safeInset("top")'), top + 28);
    assert.equal(c.run('safeInset("bottom")'), bottom);
    assert.equal(tokens['--game-status-height'], '28px');
    assert.equal(tokens['--game-safe-top'], top + 'px');
    assert.equal(tokens['--game-ui-top'], top + 28 + 'px');
    assert.ok(Math.abs(c.run('viewInset("top") * vpH() / view.h') - (top + 28)) < 0.001, 'HUD reserve survives canvas scaling');
    assert.ok(c.run('G._pauseHit.y0') >= top + 24, 'actual projected pause hit target clears badge bottom');
    const memo = JSON.parse(storage.get(c.context.SpaceManBuild.storageKey('sm2.insets')));
    assert.deepEqual(memo[width > height ? 'l' : 'p'], { top: hardware[0], right: hardware[1], bottom: hardware[2], left: hardware[3] });
    c.context.visualViewport = { offsetTop: 0, offsetLeft: 0, width, height };
    c.elements.get('gameStatusRail').offsetHeight = 0;
    c.run('readSafeInsets()');
    assert.equal(c.run('safeInset("top")'), hardware[0], 'removing rail and chrome releases the reservation');
    assert.equal(c.run('safeInset("bottom")'), hardware[2]);
  }
});
