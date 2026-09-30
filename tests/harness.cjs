const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');

// No game/network behavior is mocked. Only browser APIs and the opaque relay
// transport are replaced; clients exchange the real encrypted wire protocol.
function client(hub, { game = true, width = 1280, height = 720, storage = new Map(), hash = '', dpr = 1, navigator = {} } = {}) {
  const timers = new Set();
  const drawing = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return (s) => ({ width: String(s).length * 7 });
    if (key.startsWith('create')) return () => drawing;
    return () => {};
  } });
  function element() {
    const classes = new Set();
    return { style: { setProperty() {} }, dataset: {}, children: [], width: 1280, height: 720,
      classList: { add: (...v) => v.forEach((x) => classes.add(x)), remove: (...v) => v.forEach((x) => classes.delete(x)), contains: (v) => classes.has(v), toggle(v, on) { if (on ?? !classes.has(v)) classes.add(v); else classes.delete(v); } },
      getContext: () => drawing, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, setAttribute() {}, removeAttribute() {},
      appendChild(e) { this.children.push(e); return e; }, querySelectorAll() { return []; }, querySelector() { return null; },
      getBoundingClientRect: () => ({ top: 0, left: 0, width, height }), getClientRects: () => [{ top: 0, left: 0, width, height }], closest() { return null; }, toDataURL() { return ''; }, focus() {}, click() { if (this.onclick) this.onclick({}); } };
  }
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, createTextNode: (s) => ({ textContent: s }), querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, body: element(), head: element(), documentElement: element(), hidden: false };
  const sandbox = { console, TextEncoder, TextDecoder, URL, AbortController, Uint8Array, Uint32Array, Int32Array, Float32Array, ArrayBuffer, DataView,
    crypto: webcrypto, performance: { now: () => hub.now() }, document,
    Image: class {}, navigator, location: { hash, origin: 'https://space.test', href: 'https://space.test/' },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr, addEventListener() {},
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; },
    clearTimeout(t) { clearTimeout(t); timers.delete(t); },
    setInterval(fn, ms) { const t = setInterval(fn, ms); timers.add(t); return t; },
    clearInterval(t) { clearInterval(t); timers.delete(t); },
    WebSocket: hub.Socket,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const run = (code) => vm.runInContext(code, context);
  for (const name of ['contracts', 'save-schema', 'input-snapshot', 'course', 'worldgen', 'enemies', 'callsigns', 'relay-directory', 'qr', 'net']) run(fs.readFileSync(path.join(ROOT, 'src', name + '.js'), 'utf8'));
  if (game) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    run(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  }
  // Dispatch a DOM event to the handlers the game registered on an element (by id).
  const dispatch = (id, type, ev) => { const e = { preventDefault() {}, ...ev }; for (const fn of (elements.get(id)?.listeners[type] || [])) fn(e); };
  return { run, context, net: context.SpaceManNet, elements, dispatch, close() { context.SpaceManNet.leave(); for (const t of timers) { clearTimeout(t); clearInterval(t); } } };
}
function relay() {
  let offset = 1000;
  const clients = new Map(), sockets = new Set();
  const hub = { now: () => performance.now() + offset, advance(ms) { offset += ms; }, admissionPaused: false, packetCount: 0 };
  function frame(socket, type, payload) {
    const b = new Uint8Array(5 + payload.length); b[0] = type;
    new DataView(b.buffer).setUint32(1, payload.length, false); b.set(payload, 5);
    setImmediate(() => { if (socket.readyState === 1) socket.onmessage?.({ data: b.buffer }); });
  }
  hub.Socket = class {
    constructor() {
      sockets.add(this); this.readyState = 0;
      setImmediate(() => {
        if (this.closed) return;
        this.readyState = 1; this.onopen?.();
        frame(this, 1, hub.api.bytes.cat(new Uint8Array([0x44,0x45,0x52,0x50,0xf0,0x9f,0x94,0x91]), hub.server.pub));
      });
    }
    send(data) {
      const b = new Uint8Array(data), type = b[0], p = b.slice(5), api = hub.api;
      if (type === 2) {
        this.pub = p.slice(0, 32); clients.set(api.bytes.hex(this.pub), this);
        const key = api.nacl.boxKey(this.pub, hub.server.priv), nonce = webcrypto.getRandomValues(new Uint8Array(24));
        if (!api.nacl.secretboxOpen(p.slice(56), p.slice(32, 56), key)) throw new Error('relay client authentication failed');
        frame(this, 3, api.bytes.cat(nonce, api.nacl.secretboxSeal(api.bytes.utf8('{"version":2}'), nonce, key)));
      } else if (type === 4 && !hub.admissionPaused) {
        const dst = clients.get(api.bytes.hex(p.slice(0, 32)));
        if (dst) { hub.packetCount++; frame(dst, 5, api.bytes.cat(this.pub, p.slice(32))); }
      } else if (type === 0x12) frame(this, 0x13, p);
    }
    close() {
      this.closed = true; this.readyState = 3; sockets.delete(this);
      if (this.pub) { clients.delete(hub.api.bytes.hex(this.pub)); for (const s of sockets) frame(s, 8, this.pub); }
    }
  };
  const bootstrap = client(hub, { game: false });
  hub.api = bootstrap.net._n1;
  hub.server = hub.api.keys.keypairFromRaw(webcrypto.getRandomValues(new Uint8Array(32)));
  return hub;
}
async function until(fn, message = 'condition', timeout = 3000) {
  const start = performance.now();
  while (!fn()) { if (performance.now() - start > timeout) throw new Error('Timed out: ' + message); await new Promise((r) => setTimeout(r, 10)); }
}
module.exports = { client, relay, until };
