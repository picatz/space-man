const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

// A syntactically valid raw invite payload (URL-safe base64, long enough to be an invite).
const PAY = 'AbCdEfGh01_-'.repeat(9) + 'Zz';                 // 110 chars
const hub0 = relay();
const probe = client(hub0, { game: false });
// parseJoin runs in the game's own VM realm: compare plain data, not cross-realm prototypes.
const parse = (s) => JSON.parse(JSON.stringify(probe.net.parseJoin(s)));

test('typed room codes are read however a person writes them', () => {
  const want = { kind: 'code', code: 'COMET-42', region: 'nyc', display: 'NYC-COMET-42' };
  for (const s of ['NYC-COMET-42', 'nyc-comet-42', 'nyc comet 42', ' Nyc  Comet-4 2 ', 'NYC_COMET.42', 'nyccomet42', 'NYC—COMET—42', 'nyc\tcomet\n42']) {
    assert.deepEqual(parse(s), want, JSON.stringify(s));
  }
  // No region typed: still a code; the lookup then asks the relays nearest this device.
  for (const s of ['COMET-42', 'comet 42', 'Comet42', 'comet_4_2']) {
    assert.deepEqual(parse(s), { kind: 'code', code: 'COMET-42', region: null, display: 'COMET-42' }, JSON.stringify(s));
  }
  // Longest and shortest room words, and a region + 4-letter word (7 letters: only one way to read it).
  assert.equal(parse('nyc-cobalt-07').code, 'COBALT-07');
  assert.equal(parse('sfo-onyx-99').code, 'ONYX-99');
  assert.equal(parse('onyx-99').region, null);
});

test('invite links are found anywhere in what was pasted', () => {
  const want = { kind: 'invite', payload: PAY };
  for (const s of [
    'https://picatz.github.io/space-man/#j=' + PAY,
    'https://spacemangame.online/#j=' + PAY,
    '  https://games.test/some/path/#j=' + PAY + '  ',
    'Join my run!! https://games.test/#j=' + PAY + ' see you there',
    'https://games.test/#j=' + PAY + '.',                  // trailing punctuation from a chat message
    '#j=' + PAY, '?j=' + PAY, 'a=1&j=' + PAY, PAY,
  ]) assert.deepEqual(parse(s), want, s.slice(0, 50));
});

test('anything else is refused with a reason, and never handed on', () => {
  const reason = (s) => { const r = parse(s); assert.equal(r.kind, r.kind === 'empty' ? 'empty' : 'bad', JSON.stringify(s)); return r.reason || r.kind; };
  assert.equal(reason(''), 'empty'); assert.equal(reason('   \n'), 'empty');
  for (const bad of [null, undefined, 42, {}, [], () => 1]) assert.equal(parse(bad).kind, 'empty');
  assert.equal(reason('hello'), 'shape');
  assert.equal(reason('NYC-COMET-4'), 'shape'); assert.equal(reason('NYC-COMET-421'), 'shape'); assert.equal(reason('42'), 'shape');
  assert.equal(reason('nyc-comit-42'), 'word');                                // a typo in the word, not the region
  assert.equal(reason('zzz-comet-42'), 'region');                              // a region that is not on the map
  assert.equal(reason('j=short'), 'shape');
  assert.equal(reason('x'.repeat(5000)), 'long');
  for (const hostile of ['<script>alert(1)</script>', 'javascript:alert(1)', '"><img src=x onerror=alert(1)>', 'NYC-COMET-42<b>', '../../etc/passwd', '%00%0a']) {
    const r = parse(hostile);
    assert.ok(r.kind === 'bad' || (r.kind === 'code' && /^[A-Z]{4,6}(-[A-Z]{4,6})?-\d\d$/.test(r.code)), hostile);   // never a payload, never echoing input
  }
  // An invite is only ever a URL-safe base64 run: no other character can ride through.
  assert.equal(parse('#j=' + PAY + '<img src=x>').payload, PAY);
});

async function hostWithCode(t, opts = {}) {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  const live = new Promise((resolve) => host.net.onEvent((e) => { if (e === 'code-live') resolve(); }));
  await host.net.openRoom({ region: 'nyc', ...opts });
  await live;
  return { hub, host, guest };
}

test('a typed code with its region finds the room and joins it', async (t) => {
  const { host, guest } = await hostWithCode(t);
  const code = host.net.info().joinCode;
  assert.match(code, /^NYC-[A-Z]{4,6}-[A-Z]{4,6}-\d\d$/, 'the host shows the region with the code');
  const { invite, region } = await guest.net.lookupCode(code.toLowerCase().replace(/-/g, ' '));
  assert.equal(region, 'nyc');
  assert.equal(guest.net.parseJoin(host.net.info().link).payload, invite, 'the code and the link carry the same invite');
  await guest.net.acceptJoin(invite);
  await until(() => guest.net.roster().length === 2, 'joined');
  assert.equal(host.net.info().players, 2);
});

test('enterCode is lookup + join in one step, from a code or a pasted link', async (t) => {
  const { host, guest } = await hostWithCode(t);
  await guest.net.enterCode(host.net.info().joinCode);
  await until(() => guest.net.roster().length === 2, 'joined by code');
  guest.net.leave();
  await guest.net.enterCode('come play: ' + host.net.info().link);
  await until(() => guest.net.roster().length === 2, 'joined by link');
});

test('a bare code (no region) asks the relays nearest this device', async (t) => {
  const near = probe.net._n1.map.nearRegions(5).map((r) => r.code);
  const { host, guest } = await hostWithCode(t, { region: near[2] });
  const bare = host.net.info().code;
  assert.match(bare, /^[A-Z]{4,6}-[A-Z]{4,6}-\d\d$/);
  const found = await guest.net.lookupCode(bare);
  assert.equal(found.region, near[2]);
});

test('a code from a region far away needs its region typed, and says so', async (t) => {
  const near = probe.net._n1.map.nearRegions(5).map((r) => r.code);
  const far = probe.net.relayDirectory().regions.map((r) => r.code).find((c) => !near.includes(c));
  const { host, guest } = await hostWithCode(t, { region: far });
  await assert.rejects(guest.net.lookupCode(host.net.info().code, { timeoutMs: 400 }), /no answer/);
  const ok = await guest.net.lookupCode(host.net.info().joinCode);           // with its region it is found at once
  assert.equal(ok.region, far);
});

test('a wrong or dead code fails quickly and cleanly, and a malformed one never touches the network', async (t) => {
  const { hub, host, guest } = await hostWithCode(t);
  const good = host.net.info().joinCode;
  const wrong = good.slice(0, -2) + String((+good.slice(-2) + 1) % 100).padStart(2, '0');
  const t0 = Date.now();
  await assert.rejects(guest.net.lookupCode(wrong, { timeoutMs: 400 }), /no answer/);
  assert.ok(Date.now() - t0 < 3000, 'gives up at the timeout, not the default ten seconds');
  const before = hub.packetCount;
  await assert.rejects(guest.net.lookupCode('nyc-comit-42'), /bad code/);
  await assert.rejects(guest.net.lookupCode('zzz-comet-42'), /bad code/);
  await assert.rejects(guest.net.lookupCode(''), /bad code/);
  assert.equal(hub.packetCount, before, 'no packet for a code that cannot be one');
});

test('invite links point at the site the app is served from, and only ever at a plain web address', async (t) => {
  const pick = async (baseUrl) => {
    const hub = relay(), host = client(hub, { game: false });
    t.after(() => host.close());
    await host.net.openRoom({ relayHost: 'relay.test', region: 'nyc', code: false, baseUrl });
    return host.net.info().link;
  };
  assert.match(await pick('https://spacemangame.online/'), /^https:\/\/spacemangame\.online\/#j=/);
  assert.match(await pick('https:games.test/'), /^https:\/\/games\.test\/#j=/, 'a scheme-only-then-host form is written out in full');
  assert.match(await pick('http://192.168.1.20:8080/space-man/'), /^http:\/\/192\.168\.1\.20:8080\/space-man\/#j=/);
  for (const bad of [undefined, '', 'javascript:alert(1)', 'file:///home/x/index.html', 'https://x.test/#already', 'https://x.test/?q=1', 'https:///', 'https://user:pw@x.test/', 'http://', 'https://x .test/', 'x'.repeat(300), 42]) {
    assert.match(await pick(bad), /^https:\/\/picatz\.github\.io\/space-man\/#j=/, String(bad).slice(0, 30));
  }
});

test('a code is only offered when a guest could look it up on the host\'s own relay', async (t) => {
  const offer = async (o) => {
    const hub = relay(), host = client(hub, { game: false });
    t.after(() => host.close());
    await host.net.openRoom({ ...o });
    return host.net.info().joinCode;
  };
  assert.match(await offer({ relayHost: 'derp1f.tailscale.com', region: 'nyc' }), /^NYC-/, "the region's own relay");
  assert.equal(await offer({ relayHost: 'relay.test', region: 'nyc' }), '', 'a different relay than the region maps to');
  assert.equal(await offer({ relayHost: 'relay.test' }), '', 'a custom relay with no region');
});

test('enterCode sends a bare code to the region it is given, however far away', async (t) => {
  const near = probe.net._n1.map.nearRegions(5).map((r) => r.code);
  const far = probe.net.relayDirectory().regions.map((r) => r.code).find((c) => !near.includes(c));
  const { host, guest } = await hostWithCode(t, { region: far });
  await assert.rejects(guest.net.lookupCode(host.net.info().code, { timeoutMs: 400 }), /no answer/);
  const ok = await guest.net.lookupCode(host.net.info().code, { region: far });
  assert.equal(ok.region, far);
});

test('a room on a custom relay is joined by link or QR, not by a code nobody else could look up', async (t) => {
  const hub = relay(), host = client(hub, { game: false });
  t.after(() => host.close());
  await host.net.openRoom({ relayHost: 'my-own-relay.test', code: false });
  assert.equal(host.net.info().joinCode, '');
  assert.match(host.net.info().link, /#j=/);
});

// ---- the screen -------------------------------------------------------------------------------
const el = (c, id) => c.elements.get(id);
const shown = (c, id) => el(c, id).classList.contains('show');
async function screen(t) {
  const { hub, host } = await hostWithCode(t);
  const guest = client(hub);
  t.after(() => guest.close());
  return { hub, host, guest };
}
const type = (c, text) => { el(c, 'joinInput').value = text; };

test('Run Together opens a front door with both choices, not straight into hosting', async (t) => {
  const { guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  assert.equal(shown(guest, 'ovTogether'), true);
  assert.equal(shown(guest, 'ovRoom'), false, 'no room is created just by opening it');
  assert.equal(guest.net.active, false);
  assert.equal(typeof el(guest, 'btnCreateRoom').onclick, 'function');
  assert.equal(typeof el(guest, 'btnJoinGo').onclick, 'function');
});

test('typing the code and pressing Join goes to the usual Play/Watch prompt for that room', async (t) => {
  const { host, guest } = await screen(t);
  guest.run('G.cosmetics.callsign = [0, 0]');                                // a returning player: no first-run callsign picker
  guest.run("$('btnTogether').onclick()");
  type(guest, host.net.info().joinCode.toLowerCase().replace(/-/g, ' '));
  await guest.run('submitJoin()');
  assert.equal(shown(guest, 'ovJoin'), true, 'the join prompt is showing');
  assert.equal(shown(guest, 'ovTogether'), false);
  assert.equal(guest.run('joinPayload'), guest.net.parseJoin(host.net.info().link).payload, 'it is this room');
  await guest.run('acceptInvite(0)');                                       // Play
  await until(() => host.net.info().players === 2, 'the host sees the new player');
});

test('pasting a whole invite link (or a chat message around one) needs no code and no extra tap', async (t) => {
  const { host, guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  type(guest, 'come race me!! ' + host.net.info().link + ' :)');
  await guest.run('submitJoin()');
  assert.equal(shown(guest, 'ovJoin'), true);
  assert.equal(guest.run('joinPayload'), guest.net.parseJoin(host.net.info().link).payload);
});

test('mistakes get a specific, kind message and never leave the screen or open a socket', async (t) => {
  const { hub, guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  const before = hub.packetCount;
  const say = async (text) => { type(guest, text); await guest.run('submitJoin()'); return el(guest, 'joinHint'); };
  let h = await say('');            assert.match(h.textContent, /Type the room code/); assert.equal(h.classList.contains('err'), true);
  h = await say('hello there');     assert.match(h.textContent, /doesn't look like a room code/);
  h = await say('nyc-comit-42');    assert.match(h.textContent, /"COMIT" isn't one of our room words/);
  h = await say('zzz-comet-42');    assert.match(h.textContent, /"ZZZ" isn't a relay location/);
  h = await say('x'.repeat(5000));  assert.match(h.textContent, /too long/);
  h = await say('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(h.innerHTML || '', /<img/, 'user text is only ever shown as text');
  assert.equal(shown(guest, 'ovTogether'), true, 'still on the join screen');
  assert.equal(shown(guest, 'ovJoin'), false);
  assert.equal(hub.packetCount, before, 'nothing went on the wire');
});

test('a code nobody answers says so and puts the person back in the box', async (t) => {
  const { host, guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  const good = host.net.info().joinCode;
  const wrong = good.slice(0, -2) + String((+good.slice(-2) + 1) % 100).padStart(2, '0');
  guest.run('NET.lookupCode = ((real) => (s) => real(s, { timeoutMs: 300 }))(NET.lookupCode.bind(NET))');   // fast test timeout only
  type(guest, wrong);
  await guest.run('submitJoin()');
  assert.match(el(guest, 'joinHint').textContent, /No room answers to /);
  assert.equal(el(guest, 'joinHint').classList.contains('err'), true);
  assert.equal(el(guest, 'joinInput').disabled, false, 'the box is usable again');
  assert.equal(shown(guest, 'ovTogether'), true);
});

test('typing in the code box never fires game keys, but Escape still goes back', async (t) => {
  const { guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  const input = { tagName: 'INPUT', type: 'text' };
  const before = guest.run('JSON.stringify([settings.muted, G.mode, input.left, input.right, input.jumpHeld])');
  for (const k of ['m', 'p', 'r', 'a', 'd', 's', 'w', 'f', ' ', 'j', 'x', 'M']) {
    guest.run(`onKey({ key: ${JSON.stringify(k)}, target: { tagName: 'INPUT', type: 'text' }, preventDefault() {} }, true)`);
    guest.run(`onKey({ key: ${JSON.stringify(k)}, target: { tagName: 'INPUT', type: 'text' }, preventDefault() {} }, false)`);
  }
  assert.equal(guest.run('JSON.stringify([settings.muted, G.mode, input.left, input.right, input.jumpHeld])'), before);
  assert.equal(guest.run("isTextField({ tagName: 'BUTTON' })"), false, 'other elements still get the game keys');
  guest.run("onKey({ key: 'Escape', target: { tagName: 'INPUT', type: 'text' }, preventDefault() {} }, true)");
  assert.equal(shown(guest, 'ovTogether'), false, 'Escape closes the join screen even from inside the box');
});

test('the host card leads with the room code, and copying it copies the whole thing', async (t) => {
  const hub = relay(), guest = client(hub);
  t.after(() => guest.close());
  guest.run("$('btnTogether').onclick()");
  guest.run("G.cosmetics.callsign = [0, 0]");
  const copied = [];
  guest.context.navigator.clipboard = { writeText: (v) => { copied.push(v); return Promise.resolve(); } };
  await guest.run("openRoomFlow()");
  assert.equal(shown(guest, 'ovRoom'), true);
  const code = guest.net.info().joinCode;
  assert.match(code, /^[A-Z]{3}-[A-Z]{4,6}-[A-Z]{4,6}-\d\d$/);
  assert.equal(el(guest, 'roomCode').textContent, code);
  guest.run("$('roomCode').onclick()");
  assert.deepEqual(copied, [code]);
  assert.match(guest.net.info().link, /^https:\/\/picatz\.github\.io\/space-man\/#j=/, 'no served address in a test harness: the published site is the fallback');
});

test('a slow lookup can not open the join prompt after the person went Back', async (t) => {
  const { host, guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  let release;
  guest.run('NET.lookupCode = () => new Promise((res) => { globalThis.__release = () => res({ invite: joinPayload || 1 }); })');
  type(guest, host.net.info().joinCode);
  const pending = guest.run('submitJoin()');
  guest.run("$('btnTogetherBack').onclick()");
  guest.run('__release()');
  await pending;
  assert.equal(shown(guest, 'ovJoin'), false, 'no prompt appears for a lookup nobody is waiting on');
  assert.equal(el(guest, 'joinInput').disabled, false);
});

test('a long pasted message reaches the parser whole, and the box has no length cap of its own', async (t) => {
  const { host, guest } = await screen(t);
  assert.equal(el(guest, 'joinInput').maxLength === undefined || el(guest, 'joinInput').maxLength === -1 || el(guest, 'joinInput').maxLength === 0, true);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(src.match(/<input[^>]*id="joinInput"[^>]*>/s)[0], /maxlength/i);
});

test('copying the code says so only when it worked, and otherwise offers a selectable prompt', async (t) => {
  const hub = relay(), guest = client(hub);
  t.after(() => guest.close());
  guest.run("$('btnTogether').onclick()");
  guest.run("G.cosmetics.callsign = [0, 0]");
  await guest.run("openRoomFlow()");
  const prompts = [];
  guest.context.window.prompt = (a, b) => { prompts.push([a, b]); };
  guest.context.navigator.clipboard = { writeText: () => Promise.reject(new Error('denied')) };
  guest.run("$('roomCode').onclick()");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(prompts, [['Copy the room code', guest.net.info().joinCode]]);
  guest.context.navigator.clipboard = undefined;
  guest.run("$('roomCode').onclick()");
  assert.equal(prompts.length, 2, 'no clipboard at all: the prompt again');
});

/* ---- SEC-02: bigger code space, old codes still work, lookups are rate-limited ------------------- */

test('new codes are WORD-WORD-NN from a 128-word list: ~1.6M codes, unambiguous to read aloud', () => {
  const { invite } = probe.net._n1;
  const words = invite.CODE_WORDS;
  assert.equal(words.length, 128);
  assert.equal(new Set(words).size, 128, 'no duplicate words');
  for (const w of words) assert.match(w, /^[A-Z]{4,6}$/);
  // No word is another word's prefix or a concatenation of two others: a compact "WORDWORD42" has one reading.
  for (const a of words) for (const b of words) if (a !== b && b.startsWith(a)) assert.fail(a + ' prefixes ' + b);
  assert.ok(words.length ** 2 * 100 >= 1.6e6);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = invite.randomCode();
    assert.match(c, /^[A-Z]{4,6}-[A-Z]{4,6}-\d\d$/);
    const [w1, w2] = c.split('-');
    assert.ok(words.includes(w1) && words.includes(w2));
    seen.add(c);
  }
  assert.ok(seen.size > 1990, 'codes are random, not a small cycle');
  // Every generated code round-trips through the tolerant parser exactly.
  for (const c of seen) assert.equal(parse(c.toLowerCase().replace(/-/g, ' ')).code, c);
});

test('two-word codes are read however they are written, and pick the right keypair', () => {
  const want = { kind: 'code', code: 'COMET-ORBIT-42', region: 'nyc', display: 'NYC-COMET-ORBIT-42' };
  for (const s of ['NYC-COMET-ORBIT-42', 'nyc comet orbit 42', 'nyccometorbit42', ' Nyc  Comet-Orbit-4 2 ', 'NYC_COMET.ORBIT.42', 'nyc\tcomet\norbit 42'])
    assert.deepEqual(parse(s), want, JSON.stringify(s));
  assert.deepEqual(parse('comet orbit 42'), { kind: 'code', code: 'COMET-ORBIT-42', region: null, display: 'COMET-ORBIT-42' });
  assert.equal(parse('sfo-onyx-opal-07').code, 'ONYX-OPAL-07');
  assert.equal(parse('onyxopal07').region, null, 'no region typed: the words are not mistaken for one');
  assert.equal(parse('zzz-comet-orbit-42').reason, 'region');
  assert.equal(parse('nyc-comet-orbitt-42').reason, 'word');
  assert.equal(parse('nyc-comet-orbit-4').reason, 'shape');
  const { codeKeypair } = probe.net._n1.invite, hx = probe.net._n1.bytes.hex;
  const a = codeKeypair('nyc', 'COMET-ORBIT-42'), b = codeKeypair('nyc', 'comet-orbit-42'), c = codeKeypair('ord', 'COMET-ORBIT-42');
  assert.equal(hx(a.pub), hx(b.pub), 'case-insensitive');
  assert.notEqual(hx(a.pub), hx(c.pub), 'region-scoped');
  assert.notEqual(hx(a.pub), hx(codeKeypair('nyc', 'ORBIT-COMET-42').pub), 'word order matters');
  assert.equal(codeKeypair('nyc', 'COMET-ORBIT'), null);
  assert.equal(codeKeypair('nyc', 'COMET-ORBIT-OTTER-42'), null);
});

test('old-format codes (WORD-NN) typed by people still parse, and an old host\'s listener still resolves', async (t) => {
  assert.deepEqual(parse('NYC-COMET-42'), { kind: 'code', code: 'COMET-42', region: 'nyc', display: 'NYC-COMET-42' });
  const { invite, bytes } = probe.net._n1;
  // Legacy derivation is untouched: a fixed vector pins SHA-256("sm.code.v1|nyc|COMET-42") -> keypair.
  const legacy = invite.codeKeypair('nyc', 'COMET-42');
  const want = probe.net._n1.keys.keypairFromRaw(probe.net._n1.nacl.sha256(bytes.utf8('sm.code.v1|nyc|COMET-42')));
  assert.equal(bytes.hex(legacy.pub), bytes.hex(want.pub));
  // An old host: listens on the v1 key and answers CODEREQ with the invite, exactly as before.
  const hub = relay(), oldHost = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { oldHost.close(); guest.close(); });
  const n = oldHost.net._n1, FAKE = 'A'.repeat(90);
  const ck = n.invite.codeKeypair('nyc', 'COMET-42');
  const listener = n.RelayClient(n.RELAY_MAP.regions.find((r) => r.code === 'nyc').hosts[0], ck, {
    onOpen: () => {}, onRtt: () => {}, onDown: () => {}, onPeerGone: () => {}, onLog: () => {},
    onPacket: (src, wire) => {
      const pt = n.env.openCode(wire, src, ck.priv);
      if (!pt || pt[0] !== 1) return;
      const body = new Uint8Array(3 + FAKE.length); body[0] = 2; new DataView(body.buffer).setUint16(1, FAKE.length, true); body.set(n.bytes.utf8(FAKE), 3);
      listener.send(src, n.env.sealCode(body, src, ck.priv));
    },
  });
  t.after(() => listener.close());
  listener.connect();
  await until(() => listener.state === 'established', 'old host listening');
  const got = await guest.net.lookupCode('nyc comet 42', { timeoutMs: 3000 });
  assert.equal(got.invite, FAKE);
});

test('a new host listens only on the new two-word key, never on a legacy WORD-NN key', async (t) => {
  const { host, guest } = await hostWithCode(t);
  const code = host.net.info().code, [w1, , nn] = code.split('-');
  await assert.rejects(guest.net.lookupCode('nyc ' + w1 + ' ' + nn, { timeoutMs: 400 }), /no answer/);
  const ok = await guest.net.lookupCode('nyc ' + code, { timeoutMs: 3000 });
  assert.equal(ok.invite, guest.net.parseJoin(host.net.info().link).payload);
});

test('code lookups are rate-limited per client so a scan is slow, then recover with time', async (t) => {
  const hub = relay(), guest = client(hub, { game: false });
  t.after(() => guest.close());
  const bucket = guest.net._n1.invite.lookupBucket;
  const look = (n) => guest.net.lookupCode('nyc comet orbit ' + String(n).padStart(2, '0'), { timeoutMs: 30 });
  bucket.tokens = 3; bucket.at = hub.now();             // a fresh allowance, whatever ran before
  for (let i = 0; i < 3; i++) await assert.rejects(look(i), /no answer/, 'within the allowance: really asked');
  const before = hub.packetCount;
  for (let i = 0; i < 5; i++) await assert.rejects(look(10 + i), /too many lookups/);
  assert.equal(hub.packetCount, before, 'refused lookups put nothing on the wire');
  // A bare code asks the 5 nearest relays, so it costs 5 tokens.
  bucket.tokens = 4; bucket.at = hub.now();
  await assert.rejects(guest.net.lookupCode('comet orbit 42', { timeoutMs: 30 }), /too many lookups/);
  hub.advance(2500);                                    // 1 token per 2 s: 4 -> 5
  await assert.rejects(guest.net.lookupCode('comet orbit 42', { timeoutMs: 30 }), /no answer/);
});

test('a host answers a given requesting key once per 10 s and at most 6 times a minute', async (t) => {
  const { hub, host, guest } = await hostWithCode(t);
  const n = host.net._n1, code = host.net.info().code;
  const ck = n.invite.codeKeypair('nyc', code);
  let replies = 0;
  host.net.onEvent((e) => { if (e === 'code-reply') replies++; });
  const ask = async (tmp) => {
    // Drive the listener directly (the harness seam), as a relay-delivered packet from `tmp`.
    const body = n.bytes.cat(new Uint8Array([1]), tmp.pub);
    host.net._n1.session()._onCodePacket(tmp.pub, n.env.sealCode(body, ck.pub, tmp.priv));
  };
  const tmp = await n.keys.genKeypair();
  await ask(tmp); await ask(tmp); await ask(tmp);
  assert.equal(replies, 1, 'same key, same instant: one answer');
  hub.advance(10500);
  await ask(tmp);
  assert.equal(replies, 2, 'and again once the 10 s are up');
  for (let i = 0; i < 10; i++) await ask(await n.keys.genKeypair());
  assert.equal(replies, 6, 'fresh keys are capped at 6 replies a minute');
});

test('the join box shows a complete typed or pasted code the way it is read aloud, and hints the new shape', async (t) => {
  const { guest } = await screen(t);
  guest.run("$('btnTogether').onclick()");
  type(guest, 'nyc comet orbit 42');
  guest.run('tidyJoinInput()');
  assert.equal(el(guest, 'joinInput').value, 'NYC-COMET-ORBIT-42');
  type(guest, 'comet 42');                       // an older code stays as the person typed it, normalised
  guest.run('tidyJoinInput()');
  assert.equal(el(guest, 'joinInput').value, 'COMET-42');
  type(guest, 'half a thought');
  guest.run('tidyJoinInput()');
  assert.equal(el(guest, 'joinInput').value, 'half a thought', 'never rewrites what is not a code');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src.match(/<input[^>]*id="joinInput"[^>]*>/s)[0], /placeholder="NYC-COMET-ORBIT-42"/);
});
