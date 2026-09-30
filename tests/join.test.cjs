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
    assert.ok(r.kind === 'bad' || (r.kind === 'code' && /^[A-Z]{4,6}-\d\d$/.test(r.code)), hostile);   // never a payload, never echoing input
  }
  // An invite is only ever a URL-safe base64 run: no other character can ride through.
  assert.equal(parse('#j=' + PAY + '<img src=x>').payload, PAY);
});

async function hostWithCode(t, opts = {}) {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  const live = new Promise((resolve) => host.net.onEvent((e) => { if (e === 'code-live') resolve(); }));
  await host.net.openRoom({ relayHost: 'derp1f.tailscale.com', region: 'nyc', ...opts });
  await live;
  return { hub, host, guest };
}

test('a typed code with its region finds the room and joins it', async (t) => {
  const { host, guest } = await hostWithCode(t);
  const code = host.net.info().joinCode;
  assert.match(code, /^NYC-[A-Z]{4,6}-\d\d$/, 'the host shows the region with the code');
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
  assert.match(bare, /^[A-Z]{4,6}-\d\d$/);
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
  const { host, guest } = await hostWithCode(t, { region: far, relayHost: undefined });
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
  assert.match(code, /^[A-Z]{3}-[A-Z]{4,6}-\d\d$/);
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
