const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { client, relay } = require('./harness.cjs');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SW_SRC = read('service-worker.js');
const SHELL = vm.runInNewContext(SW_SRC.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
const norm = (u) => './' + u.replace(/^\.\//, '');

test('everything index.html and manifest.json reference is precached for offline play', () => {
  const html = read('index.html'), manifest = JSON.parse(read('manifest.json'));
  const refs = [
    ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link\s+rel="(?:manifest|icon|apple-touch-icon)"[^>]*\shref="([^"]+)"/g)].map((m) => m[1]),
    ...manifest.icons.map((i) => i.src), ...manifest.screenshots.map((s) => s.src),
  ].filter((u) => !/^[a-z]+:/i.test(u));
  assert.ok(refs.filter((u) => u.startsWith('src/')).length >= 7, 'found the src/ scripts');
  for (const u of refs) assert.ok(SHELL.includes(norm(u)), `${u} missing from service-worker.js SHELL`);
  assert.ok(SHELL.includes('./') && SHELL.includes('./index.html'));
  for (const u of SHELL) if (u !== './') assert.ok(fs.existsSync(path.join(ROOT, u)), `SHELL entry ${u} does not exist`);
});

test('every src/ module is loaded by the page, precached, and run by the test harness in page order', () => {
  const html = read('index.html');
  const pageSrc = [...html.matchAll(/<script\s+src="src\/([^"]+)\.js"/g)].map((m) => m[1]);
  const onDisk = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
  assert.deepEqual([...onDisk].sort(), [...pageSrc].sort(), 'a module on disk that the page never loads (or the reverse)');
  for (const m of onDisk) assert.ok(SHELL.includes('./src/' + m + '.js'), m + '.js missing from the precache');
  assert.deepEqual(require('./harness.cjs').MODULES, pageSrc, 'tests/harness.cjs MODULES must follow index.html order');
});

// Minimal service-worker runtime: real service-worker.js, fake caches + network.
// `stores` can be shared between two workers to play a deploy (old build active,
// new build installing beside it); `version` rewrites VERSION for the second one.
function worker({ online = true, stores = new Map(), version = null, failInstall = null } = {}) {
  const listeners = {}, net = [];
  const src = version ? SW_SRC.replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`) : SW_SRC;
  const build = src.match(/VERSION = '([^']+)'/)[1];
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, 'https://space.test/').pathname;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return { put: async (r, res) => { m.set(key(r), res); }, match: async (r) => m.get(key(r)),
        // addAll is atomic in the platform: one failure and nothing is stored.
        addAll: async (rs) => {
          if (failInstall && rs.some((r) => key(r) === failInstall)) throw new TypeError('network error');
          rs.forEach((r) => m.set(key(r), { ok: true, body: build + ' ' + key(r) }));
        } };
    },
    async match(r) { for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r)); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
  const self = { location: { origin: 'https://space.test' }, skipped: 0,
    addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting() { this.skipped++; }, clients: { claim() {} } };
  const fetch = async (r, init) => {
    net.push({ url: key(r), init });
    if (!online) throw new TypeError('offline');
    const res = { ok: true, type: 'basic', body: 'network ' + key(r) };
    res.clone = () => res;
    return res;
  };
  vm.runInNewContext(src, { self, caches, fetch, URL, Request: class { constructor(u) { this.url = u; } } });
  async function lifecycle(type) { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); await p; }
  async function request(url, { method = 'GET', mode = 'cors', destination = 'script' } = {}) {
    let responded = null; const waits = [];
    listeners.fetch({ request: { url: new URL(url, 'https://space.test/').href, method, mode, destination },
      respondWith: (p) => { responded = p; }, waitUntil: (p) => waits.push(p) });
    const res = responded && await responded; await Promise.all(waits);
    return res;
  }
  return { self, stores, net, build, lifecycle, request, setOnline(v) { online = v; } };
}
const nav = (sw, url = '/') => sw.request(url, { mode: 'navigate', destination: 'document' });
// Everything a launch loads, as the page would request it.
async function launch(sw, url = '/') {
  const out = [(await nav(sw, url)).body];
  for (const u of SHELL) if (u.startsWith('./src/')) out.push((await sw.request(u.slice(1))).body);
  return out;
}

test('service worker: a launch is one build, straight from its cache — online, offline or mid-deploy', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(sw.self.skipped, 0, 'a fresh install of this generation waits for the page');
  await sw.lifecycle('activate');
  const v = sw.build;
  const same = (bodies) => bodies.every((b) => b.startsWith(v + ' '));
  // Online: no network on the critical path of a launch (a plane's Wi-Fi can hang for a minute).
  const before = sw.net.length;
  assert.ok(same(await launch(sw, '/?daily=1')), 'page + every script from the same build');
  assert.equal(sw.net.length, before, 'no network requests at all');
  // Offline: the same.
  sw.setOnline(false);
  assert.ok(same(await launch(sw, '/#j=abc')), 'offline launch is whole');
  sw.setOnline(true);
  // A deploy lands on the server (network now serves new files) while this build is active:
  // this page and its scripts still come from one build.
  assert.ok(same(await launch(sw)), 'a deploy never splits the running build');
  // A file outside the shell comes from the network once, then works offline.
  assert.equal((await sw.request('/screenshots/extra.png', { destination: 'image' })).body, 'network /screenshots/extra.png');
  sw.setOnline(false);
  assert.equal((await sw.request('/screenshots/extra.png', { destination: 'image' })).body, 'network /screenshots/extra.png');
  assert.equal(await sw.request('https://relay.example/x.js'), null, 'cross-origin is not intercepted');
  assert.equal(await sw.request('/src/net.js', { method: 'POST' }), null, 'non-GET is not intercepted');
});

test('service worker: an update installs beside the running build and only takes over whole', async () => {
  const stores = new Map();
  const old = worker({ stores, version: 'v1.0.0' });
  await old.lifecycle('install'); await old.lifecycle('activate');
  // The new build's download fails halfway (flaky link): nothing half-installed, old build intact.
  const broken = worker({ stores, version: 'v2.0.0', failInstall: '/src/net.js' });
  await assert.rejects(broken.lifecycle('install'));
  assert.equal(stores.get('sm2-app-v2.0.0').size, 0, 'an interrupted install stores nothing');
  assert.ok((await launch(old)).every((b) => b.startsWith('v1.0.0 ')));
  // A clean install: both builds sit side by side; the running page keeps v1 until the swap.
  const next = worker({ stores, version: 'v2.0.0' });
  await next.lifecycle('install');
  assert.equal(next.self.skipped, 0, 'waits for the page to pick a safe moment');
  assert.ok((await launch(old)).every((b) => b.startsWith('v1.0.0 ')), 'no mixing while the new build waits');
  await next.lifecycle('activate');
  assert.deepEqual([...stores.keys()], ['sm2-app-v2.0.0'], 'the old build is dropped only after the new one is whole');
  assert.ok((await launch(next)).every((b) => b.startsWith('v2.0.0 ')), 'the reload is entirely the new build');
});

test('service worker: replaces a legacy cache-first worker at once and drops old caches', async () => {
  const sw = worker();
  sw.stores.set('sm2-shell-v3.3.0', new Map([['/src/net.js', { ok: true, body: 'stale' }]]));
  await sw.lifecycle('install');
  assert.equal(sw.self.skipped, 1);
  await sw.lifecycle('activate');
  assert.deepEqual([...sw.stores.keys()], ['sm2-app-' + SW_SRC.match(/VERSION = '([^']+)'/)[1]]);
});

function slowFrames(c, n, ms) { c.run(`for (let i = 0; i < ${n}; i++) { __t += ${ms}; frame(__t); }`); }

test('adaptive resolution: caps DPR at 2, steps down on a slow device, SHARP RENDERING locks it', (t) => {
  const c = client(relay(), { dpr: 3, width: 390, height: 844 });
  t.after(() => c.close());
  c.run('var __t = 1000; frame(__t);');
  assert.equal(c.run('view.dpr'), 2);
  const w = c.run('view.w');
  slowFrames(c, 120, 16);   // a healthy 60fps device keeps full resolution
  assert.equal(c.run('view.dpr'), 2);
  slowFrames(c, 150, 30);   // ~1s settle + ~2s over budget
  assert.equal(c.run('view.dpr'), 1.5);
  assert.ok(Math.abs(c.run('view.w') - w) < 1, 'logical view is resolution-independent');
  slowFrames(c, 150, 30);
  assert.equal(c.run('view.dpr'), 1);
  c.run('toggleSetting("sharp")');
  assert.equal(c.run('settings.sharp'), true);
  assert.equal(c.run('view.dpr'), 2, 'SHARP RENDERING restores full DPR');
  slowFrames(c, 400, 30);
  assert.equal(c.run('view.dpr'), 2, 'and holds it');
});

test('adaptive resolution waits for a calm moment mid-run unless the device is badly behind', (t) => {
  const c = client(relay(), { dpr: 2 });
  t.after(() => c.close());
  c.run('var __t = 1000; frame(__t); startRun(); G.freeze = 1e9;');   // hitstop: live run, frozen sim
  slowFrames(c, 300, 30);
  assert.equal(c.run('view.dpr'), 2, 'no mid-run pop at ~33fps');
  slowFrames(c, 40, 60);
  assert.equal(c.run('view.dpr'), 1.5, '<25fps steps down immediately');
});

test('adaptive resolution never runs under #shot (fixed-DPR goldens)', (t) => {
  const c = client(relay(), { dpr: 3, hash: '#shot=pause&seed=1' });
  t.after(() => c.close());
  assert.equal(c.run('view.dpr'), 2);
  c.run('for (let i = 0; i < 400; i++) adaptResolution(0.06);');
  assert.equal(c.run('view.dpr'), 2);
  assert.equal(c.run('SETTINGS_DEF.find((d) => d.key === "sharp").noShot'), true, 'row stays out of the settings goldens');
});

test('a guarded update reload is deferred, not dropped, and never re-stamps the guard', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  const store = new Map();
  let reloads = 0;
  c.context.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  c.context.location.reload = () => { reloads++; };
  c.run("showAttract(); swu.ready = true; swu.readyAt = G.time - 10; swu.reg = null;");
  const recent = String(Date.now() - 5000);
  store.set('sm2.swReload', recent);               // the 4s fallback reload just ran
  c.run('tickUpdate()');
  assert.equal(reloads, 0);
  assert.equal(c.run('swu.ready'), true, 'still waiting to apply');
  assert.equal(store.get('sm2.swReload'), recent, 'a refused attempt must not move the guard');
  store.set('sm2.swReload', String(Date.now() - 31000));   // guard window has passed
  c.run('swu.readyAt = G.time - 10; tickUpdate()');
  assert.equal(reloads, 1);
});
