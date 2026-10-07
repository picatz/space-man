// SOC-01/02/03: lobby READY, rematch AGAIN? and last-room memory. Votes ride forward-compatible
// emote ids 6 and 7; the pure logic is tested directly and the wire through real encrypted rooms.
const test = require('node:test');
const assert = require('node:assert/strict');
const Social = require('../src/room-social.js');
const { client, relay, until } = require('./harness.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const roster = (...ps) => ps.map(p => ({ p, role: 0, spectator: false }));

test('signals map to kinds, and only 6 and 7 are signals', () => {
  assert.equal(Social.kindOf(6), 'again'); assert.equal(Social.kindOf(7), 'ready');
  for (const id of [0, 1, 2, 3, 4, 5, 8, 255, -1, undefined]) assert.equal(Social.kindOf(id), null, String(id));
  assert.deepEqual({ ...Social.IDS }, { again: 6, ready: 7 });
});

test('tally counts seated humans only; spectators, leavers and absent voters never count', () => {
  const v = Social.createVotes();
  const r = [...roster(1, 2, 3), { p: 4, role: 1, spectator: true }];
  assert.deepEqual(v.tally('ready', r), { n: 0, m: 3, missing: [1, 2, 3] });
  assert.equal(v.toggle('ready', 2), true); v.toggle('ready', 4);          // a spectator's vote is ignored
  assert.deepEqual(v.tally('ready', r), { n: 1, m: 3, missing: [1, 3] });
  assert.equal(v.toggle('ready', 2), false, 'a second signal withdraws the vote');
  v.toggle('ready', 1); v.toggle('ready', 3);
  assert.deepEqual(v.tally('ready', r), { n: 2, m: 3, missing: [2] });
  assert.deepEqual(v.tally('ready', roster(1, 3)), { n: 2, m: 2, missing: [] }, 'a player who left drops out of the denominator');
  assert.deepEqual(v.tally('again', r).n, 0, 'kinds are independent');
  assert.equal(v.drop(1), true); assert.equal(v.has('ready', 1), false);
  assert.equal(v.clear('ready'), true); assert.equal(v.clear('ready'), false);
  assert.equal(v.toggle('bogus', 1), false); assert.deepEqual(v.tally('bogus', r).n, 0);
});

test('auto-start needs two or more seated humans who have all voted', () => {
  const u = Social.unanimous;
  assert.equal(u({ n: 0, m: 0 }), false); assert.equal(u({ n: 1, m: 1 }), false, 'a lone player never auto-starts');
  assert.equal(u({ n: 1, m: 2 }), false); assert.equal(u({ n: 2, m: 2 }), true); assert.equal(u({ n: 3, m: 4 }), false);
  assert.equal(u(null), false);
});

test('the countdown arms once, disarms when the condition lapses, and can be cancelled', () => {
  const timers = []; let now = 0;
  const fired = [];
  const a = Social.createAutoStart({ delay: 3000, now: () => now, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { timers[id - 1].dead = true; }, fire: k => fired.push(k) });
  assert.equal(a.evaluate('ready', false), false);
  assert.equal(a.evaluate('ready', true), true); assert.equal(a.kind, 'ready'); assert.equal(a.remainingMs(), 3000);
  assert.equal(a.evaluate('ready', true), false, 'already armed');
  now = 1000; assert.equal(a.remainingMs(), 2000);
  assert.equal(a.evaluate('ready', false), true, 'someone un-voted'); assert.equal(a.kind, null); assert.ok(timers[0].dead);
  a.evaluate('again', true); timers[1].fn(); assert.deepEqual(fired, ['again']); assert.equal(a.kind, null);
  a.evaluate('again', true); assert.equal(a.cancel(), 'again'); assert.ok(timers[2].dead); assert.deepEqual(fired, ['again']);
});

function fakeEnv(over = {}) {
  const timers = []; const sent = []; let changes = 0, started = [];
  const state = { host: true, myP: 1, role: 0, lobby: true, over: false, blocked: false, roster: roster(1, 2, 3) };
  const env = {
    net: { signal: id => sent.push(id) }, host: () => state.host, roster: () => state.roster, myP: () => state.myP, myRole: () => state.role,
    isLobby: () => state.lobby, isOver: () => state.over, blocked: () => state.blocked, changed: () => changes++, autoStart: k => started.push(k),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; }, ...over,
  };
  return { env, state, sent, started, timers, get changes() { return changes; }, fire: () => { const fn = timers.filter(Boolean).pop(); if (fn) fn(); } };
}

test('ready: auto-start arms only when every seated human is ready, the host included, and the host can switch it off', () => {
  const f = fakeEnv(); const rv = Social.createRoomVotes(f.env);
  rv.onSignal(2, 7); rv.onSignal(3, 7);
  assert.equal(rv.status().auto, null, 'the host has not said ready yet');
  assert.equal(rv.vote('ready'), true); assert.deepEqual(f.sent, [7], 'the host also tells guests');
  assert.equal(rv.status().auto, 'ready'); assert.deepEqual(rv.status().ready, { n: 3, m: 3, missing: [], mine: true, pending: false, unconfirmed: false });
  f.fire(); assert.deepEqual(f.started, ['ready']);
  rv.reset(); rv.setAutoStart(false);
  rv.onSignal(2, 7); rv.onSignal(3, 7); rv.vote('ready');
  assert.equal(rv.status().auto, null, 'auto-start switched off: the tally still shows, the host starts by hand');
  assert.equal(rv.status().ready.n, 3);
});

test('ready: a late un-ready, a leaver or a new seat cancels the countdown; cancel sticks until the votes change', () => {
  const f = fakeEnv(); const rv = Social.createRoomVotes(f.env);
  rv.onSignal(2, 7); rv.onSignal(3, 7); rv.vote('ready'); assert.equal(rv.status().auto, 'ready');
  rv.onSignal(3, 7); assert.equal(rv.status().auto, null, 'guest 3 withdrew');
  rv.onSignal(3, 7); assert.equal(rv.status().auto, 'ready');
  f.state.roster = roster(1, 2, 3, 4); rv.evaluate(); assert.equal(rv.status().auto, null, 'a fourth seat appeared, not unanimous');
  f.state.roster = roster(1, 2, 3); rv.evaluate(); assert.equal(rv.status().auto, 'ready');
  assert.equal(rv.cancelAuto(), true); assert.equal(rv.status().auto, null);
  rv.evaluate(); assert.equal(rv.status().auto, null, 'a cancelled countdown does not re-arm on its own');
  rv.onSignal(2, 7); assert.equal(rv.status().auto, null, 'guest 2 withdrew: nothing to start');
  rv.onSignal(2, 7); assert.equal(rv.status().auto, 'ready', 'changed votes are a fresh decision, so the countdown arms again');
  rv.cancelAuto(); rv.drop(3); f.state.roster = roster(1, 2); rv.evaluate();
  assert.equal(rv.status().auto, 'ready', 'a different roster is a new decision too');
  f.state.blocked = true; rv.evaluate(); assert.equal(rv.status().auto, null, 'connection trouble holds the start');
});

test('ready only exists in the lobby; again only on the results; observe() clears stale votes', () => {
  const f = fakeEnv(); const rv = Social.createRoomVotes(f.env);
  f.state.lobby = false; assert.equal(rv.vote('ready'), false, 'no ready vote mid-match');
  f.state.lobby = true; assert.equal(rv.vote('again'), false, 'no rematch vote before the results');
  rv.onSignal(2, 7); f.state.lobby = false; assert.equal(rv.observe(), true); assert.equal(rv.status().ready.n, 0);
  f.state.over = true; rv.onSignal(2, 6); assert.equal(rv.status().again.n, 2, 'guest 2 plus the implicit host');
  f.state.over = false; assert.equal(rv.observe(), true); assert.equal(rv.status().again.n, 1, 'only the implicit host is left');
  f.state.role = 1; f.state.over = true; assert.equal(rv.vote('again'), false, 'spectators cannot vote');
});

test('again: the host counts as wanting a rematch; everyone else voting arms a countdown; a leaver is dropped', () => {
  const f = fakeEnv(); const rv = Social.createRoomVotes(f.env); f.state.lobby = false; f.state.over = true;
  assert.deepEqual(rv.status().again, { n: 1, m: 3, missing: [2, 3], mine: false, pending: false, unconfirmed: false });
  rv.onSignal(2, 6); assert.equal(rv.status().auto, null);
  rv.onSignal(3, 6); assert.equal(rv.status().auto, 'ready' === 'x' ? null : 'again');
  f.fire(); assert.deepEqual(f.started, ['again']);
  rv.reset(); rv.onSignal(2, 6); rv.drop(2); assert.equal(rv.status().again.n, 1);
  f.state.roster = roster(1); f.state.host = true; rv.evaluate(); assert.equal(rv.status().auto, null, 'a lone host never auto-starts');
});

test('guest votes wait for the host echo; no echo within the window is reported as unconfirmed (older host)', () => {
  const f = fakeEnv(); f.state.host = false; f.state.myP = 2; const rv = Social.createRoomVotes(f.env);
  assert.equal(rv.vote('ready'), true); assert.deepEqual(f.sent, [7]);
  assert.equal(rv.status().ready.pending, true); assert.equal(rv.status().ready.mine, false);
  assert.equal(rv.vote('ready'), false, 'no double send while one is in flight');
  rv.onSignal(2, 7);                                          // the host's EMOTEB echo
  assert.deepEqual([rv.status().ready.mine, rv.status().ready.pending], [true, false]);
  rv.reset(); assert.equal(rv.vote('ready'), true);
  f.fire();                                                   // the pending window elapses with no echo
  assert.deepEqual([rv.status().ready.pending, rv.status().ready.unconfirmed, rv.status().ready.mine], [false, true, false]);
  assert.equal(rv.status().auto, null, 'a guest never owns the start');
});

// ---- last room memory (SOC-03)
function fakeStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; }

test('last room: stores only region, code, mode and time; recalls within 20 minutes; expires after', () => {
  let now = 1_000_000; const storage = fakeStorage();
  const s = Social.createLastRoomStore({ storage, key: 'k', now: () => now });
  assert.equal(s.load('arena'), null);
  const saved = s.save({ region: 'ord', code: 'COMET-ORBIT-42', mode: 'arena', secret: 'nope', invite: 'AAAA', priv: 'x' });
  assert.deepEqual(saved, { region: 'ord', code: 'COMET-ORBIT-42', mode: 'arena', ts: now });
  assert.deepEqual(Object.keys(JSON.parse(storage.m.get('k'))).sort(), ['code', 'mode', 'region', 'ts'], 'nothing else is persisted');
  assert.equal(Social.lastRoomText(saved), 'ORD-COMET-ORBIT-42');
  now += 19 * 60_000; assert.equal(s.load('arena').code, 'COMET-ORBIT-42');
  assert.equal(s.load('race'), null, 'another mode does not see it');
  assert.ok(storage.m.has('k'), 'a mismatched mode does not delete it');
  now += 2 * 60_000; assert.equal(s.load('arena'), null, 'expired');
  assert.equal(storage.m.has('k'), false, 'expired entries are removed');
});

test('last room: corrupt, hostile, future-dated or storage-less environments never throw', () => {
  const now = 5_000_000;
  const bad = [null, [], 'x', 5, { code: 'ok-1', ts: 'soon' }, { code: '../../x', ts: now }, { code: '', ts: now }, { code: 'A'.repeat(80), ts: now }, { code: 'COMET-1', ts: now + 60_000 }, { code: '<img>', ts: now }, { code: 'COMET-1', ts: NaN }];
  for (const raw of bad) assert.equal(Social.sanitizeLastRoom(raw, now), null, JSON.stringify(raw));
  assert.deepEqual(Social.sanitizeLastRoom({ code: 'COMET-ORBIT-42', ts: now, region: '<script>' }, now), { region: '', code: 'COMET-ORBIT-42', mode: 'runner', ts: now }, 'a bad region is blanked, an unknown mode is the runner');
  const storage = fakeStorage(); storage.setItem('k', '{not json');
  const s = Social.createLastRoomStore({ storage, key: 'k', now: () => now });
  assert.equal(s.load(), null); assert.equal(storage.m.has('k'), false, 'corrupt JSON is cleared');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const t = Social.createLastRoomStore({ storage: throwing, key: 'k', now: () => now });
  assert.doesNotThrow(() => { t.save({ code: 'COMET-ORBIT-42' }); t.clear(); }); assert.equal(t.load(), null);
  assert.equal(Social.createLastRoomStore({ storage: null, key: 'k' }).save({ code: 'x1' }) === null || true, true);
});

// ---- wire: emote ids 6 and 7 across a real encrypted room
async function runnerRoom(t) {
  const hub = relay(), host = client(hub, { game: false }), guest = client(hub, { game: false });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], {});
  await until(() => guest.net.roster().length === 2, 'roster');
  const hs = host.net._n1.session(), E = host.net._room.emote;
  const events = (c) => { const e = []; c.net.onEvent('emote', d => e.push(d)); return e; };
  return { hub, host, guest, hs, E, hev: events(host), gev: events(guest) };
}
async function rawFromGuest(r, plain) {
  const gs = r.guest.net._n1.session();
  await r.hs._onPacket(gs.keys.pub, await r.guest.net._n1.env.sealApp(gs.pair, plain));
}

test('wire: ids 6 and 7 reach the host and every guest as events, draw no bubble, and strike nobody', async t => {
  const r = await runnerRoom(t), row = [...r.hs.roster.values()][0];
  assert.equal(r.E.EMOTE_MAX, 5, 'bubbles still stop at id 5'); assert.equal(r.E.SIGNAL_MAX, 7);
  assert.equal(r.guest.net.signal(7), 7);
  await until(() => r.hev.length === 1 && r.gev.length === 1, 'host event + echo');
  assert.deepEqual([r.hev[0].p, r.hev[0].id, r.gev[0].p, r.gev[0].id], [row.p, 7, row.p, 7]);
  assert.equal(r.host.net.signal(6), 6);
  await until(() => r.gev.length === 2, 'host signal fans out');
  assert.deepEqual([r.gev[1].p, r.gev[1].id], [1, 6]);
  const p = r.host.net.presence().concat(r.guest.net.presence());
  assert.ok(p.every(x => !(x.emoteId > 5)), 'no presence row ever carries a signal id as a bubble');
  assert.equal(row.strikes, 0); assert.equal(row.emoteId, 0, 'the sender\'s bubble state is untouched');
});

test('wire: out-of-range ids (8+) are dropped at receipt without a strike or a broadcast, exactly like an older host drops 6 and 7', async t => {
  const r = await runnerRoom(t), row = [...r.hs.roster.values()][0], gs = r.guest.net._n1.session();
  for (const id of [8, 9, 100, 255]) await rawFromGuest(r, r.E.encEmote(r.guest.net._n1.frames.makeScratch(), id, 1));
  await sleep(60);
  assert.equal(row.strikes, 0, 'no strike'); assert.equal(r.hev.length, 0); assert.equal(r.gev.length, 0, 'nothing was broadcast');
  // the bubble bucket was not charged: three real emotes still pass
  for (let i = 0; i < 3; i++) await rawFromGuest(r, r.E.encEmote(r.guest.net._n1.frames.makeScratch(), 3, i));
  await until(() => r.hev.length === 3 && r.gev.length === 3, 'bubble emotes still allowed, and echoed');
  // a guest ignores out-of-range EMOTEB as well
  const scratch = r.host.net._n1.frames.makeScratch(), hostRow = r.hs.roster.get(r.host.net._n1.bytes.hex(gs.keys.pub));
  await gs._onPacket(r.hs.keys.pub, await r.host.net._n1.env.sealApp(hostRow.pair, r.E.encEmoteB(scratch, 1, 8, 1).slice()));
  await sleep(40); assert.equal(r.gev.length, 3, 'the forged out-of-range broadcast raised no event');
});

test('wire: signals have their own bucket (burst 3, refill 1/s): spamming drops without a strike and never eats a bubble emote', async t => {
  const r = await runnerRoom(t), row = [...r.hs.roster.values()][0], F = r.guest.net._n1.frames;
  for (let i = 0; i < 8; i++) await rawFromGuest(r, r.E.encEmote(F.makeScratch(), 7, i));
  await sleep(60);
  assert.equal(r.hev.filter(e => e.id === 7).length, 3, 'only the burst of three gets through'); assert.equal(row.strikes, 0);
  await rawFromGuest(r, r.E.encEmote(F.makeScratch(), 2, 1));
  await until(() => r.hev.some(e => e.id === 2), 'a bubble emote is unaffected by the signal bucket');
});

test('wire: only signal ids go through NET.signal; NET.emote still refuses them', async t => {
  const r = await runnerRoom(t);
  assert.equal(r.guest.net.signal(3), undefined); assert.equal(r.guest.net.signal(8), undefined); assert.equal(r.guest.net.signal(-1), undefined);
  assert.equal(r.guest.net.emote(6), undefined); assert.equal(r.guest.net.emote(7), undefined);
  await sleep(40); assert.equal(r.hev.length, 0);
});

// ---- rooms: arena coordinators end to end
async function arenaRooms(t, { guests = 1, delay = 40, fast = false } = {}) {
  const hub = relay(), all = [];
  function peer(fast) {
    const c = client(hub, { game: false }); all.push(c); if (fast) fastHost(c); c.autos = []; c.changes = 0;
    c.context.__auto = k => c.autos.push(k); c.context.__changed = () => { c.changes++; };
    c.run(`window.room = SpaceManArenaRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false}),autoStartDelayMs:${delay},onAutoStart:__auto,onChange:__changed});`);
    c.room = c.context.room; return c;
  }
  function fastHost(c) {   // shrink the match clock through the authority so results arrive in a few hundred ticks
    c.run(`(() => { const o = SpaceManArenaOnline, make = o.createHost; window.SpaceManArenaOnline = Object.assign({}, o, { createHost(cfg) { const h = make(cfg), s = h.start; h.start = (...a) => { const ok = s.apply(h, a); if (ok) h.state.timeLeftTicks = 20; return ok; }; return h; } }); })();`);
  }
  t.after(() => { for (const c of all) { c.room.close(); c.close(); } });
  const host = peer(fast); assert.equal(await host.room.hosting({ format: 'ffa', arenaId: 'orbital-dock' }), true);
  const invite = host.net.info().link, gs = [];
  for (let i = 0; i < guests; i++) { const g = peer(); assert.equal(await g.room.join(invite, 0), true); gs.push(g); }
  await until(() => host.net.roster().length === guests + 1 && gs.every(g => g.room.current), 'seated');
  return { hub, host, gs, peer };
}

test('arena: guest ready reaches the host tally; everyone ready arms the countdown, which calls back once; the host keeps control', async t => {
  const { host, gs } = await arenaRooms(t, { guests: 2 }), [a, b] = gs;
  assert.deepEqual([host.room.status().votes.ready.n, host.room.status().votes.ready.m], [0, 3]);
  assert.equal(a.room.vote('ready'), true);
  await until(() => host.room.status().votes.ready.n === 1 && a.room.status().votes.ready.mine, 'host tally + guest echo');
  assert.equal(a.room.status().votes.ready.pending, false);
  assert.equal(b.room.status().votes.ready.mine, false);
  assert.equal(b.room.vote('ready'), true); await until(() => host.room.status().votes.ready.n === 2, 'second guest');
  await sleep(100); assert.deepEqual(host.autos, [], 'the host has not said ready: nothing starts by itself');
  host.room.vote('ready'); assert.equal(host.room.status().votes.auto, 'ready');
  await until(() => host.autos.length === 1, 'countdown fired'); assert.deepEqual(host.autos, ['ready']);
  assert.deepEqual(a.autos, [], 'guests never start anything');
});

test('arena: the host can turn auto-start off or cancel the countdown', async t => {
  const { host, gs } = await arenaRooms(t, { delay: 120 }), [a] = gs;
  host.room.setAutoStart(false); a.room.vote('ready'); host.room.vote('ready');
  await until(() => host.room.status().votes.ready.n === 2, 'both ready'); await sleep(200);
  assert.deepEqual(host.autos, [], 'auto-start off'); assert.equal(host.room.status().votes.autoStart, false);
  host.room.setAutoStart(true); assert.equal(host.room.status().votes.auto, 'ready');
  assert.equal(host.room.cancelAuto(), true); await sleep(250); assert.deepEqual(host.autos, [], 'cancelled');
});

test('arena: a leaver and a spectator change the denominator; starting clears the ready votes', async t => {
  const { host, gs, peer } = await arenaRooms(t, { guests: 2, delay: 60 }), [a, b] = gs;
  a.room.vote('ready'); host.room.vote('ready');
  await until(() => host.room.status().votes.ready.n === 2, 'two of three');
  assert.equal(host.room.status().votes.auto, null);
  b.room.close();                                            // b leaves the room
  await until(() => host.room.status().votes.ready.m === 2, 'denominator shrinks');
  await until(() => host.autos.length === 1, 'the remaining seated humans are all ready');
  assert.equal(host.room.start(5), true);
  assert.equal(host.room.status().votes.ready.n, 0, 'the match started: votes reset');
  const spectator = peer(); assert.equal(await spectator.room.join(host.net.info().link, 1), true);
  await until(() => host.net.roster().length === 3, 'spectator in');
  assert.equal(host.room.status().votes.ready.m, 2, 'a spectator is not a seated human');
  assert.equal(spectator.room.vote('ready'), false);
});

test('arena: rematch votes tally after the results and auto-start a short countdown', { timeout: 40000 }, async t => {
  const { hub, host, gs } = await arenaRooms(t, { guests: 2, delay: 60, fast: true }), [a, b] = gs;
  assert.equal(a.room.vote('again'), false, 'not before the results');
  assert.equal(host.room.start(7), true);
  await until(() => a.room.current.status === 'running', 'running');
  for (let i = 0; i < 600 && host.room.current.state.phase !== 'over'; i++) {
    hub.advance(1000 / 60); host.room.step({}, hub.now()); a.room.step({}, hub.now()); b.room.step({}, hub.now());
    if (i % 5 === 0) await sleep(1);
  }
  await until(() => [host, a, b].every(c => c.room.current.state.phase === 'over'), 'results everywhere', 8000);
  const tally = () => host.room.status().votes.again;
  assert.equal(tally().n, 1, 'only the host is implicitly in'); assert.equal(tally().m, 3);
  assert.equal(a.room.status().votes.again.mine, false);
  assert.equal(a.room.vote('again'), true);
  await until(() => a.room.status().votes.again.mine && tally().n === 2, 'tally and echo');
  assert.equal(tally().missing.length, 1); assert.equal(host.room.status().votes.auto, null);
  assert.equal(a.room.vote('again'), true);                  // changed their mind
  await until(() => !a.room.status().votes.again.mine && tally().n === 1, 'withdrawn');
  a.room.vote('again'); await until(() => tally().n === 2, 'back in');
  b.room.vote('again');
  await until(() => host.autos.length === 1, 'everyone wants a rematch: countdown fires'); assert.deepEqual(host.autos, ['again']);
  assert.equal(host.room.lobby(), true);
  await until(() => host.room.status().votes.again.n === 1 && a.room.status().votes.again.mine === false, 'returning to the lobby clears rematch votes');
});

test('race: guest ready reaches the host tally and everyone ready arms the countdown', async t => {
  const hub = relay(), all = [];
  const peer = () => {
    const c = client(hub, { game: false }); all.push(c); c.autos = []; c.context.__auto = k => c.autos.push(k);
    c.run(`window.room = SpaceManRaceRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test',code:false}),autoStartDelayMs:40,onAutoStart:__auto});`);
    c.room = c.context.room; return c;
  };
  t.after(() => { for (const c of all) { c.room.close(); c.close(); } });
  const host = peer(); assert.equal(await host.room.hosting({ trackId: 'starlight', difficulty: 'normal' }), true);
  const guest = peer(); assert.equal(await guest.room.join(host.net.info().link, 0), true);
  await until(() => host.net.roster().length === 2 && guest.room.current, 'seated');
  assert.equal(guest.room.vote('ready'), true);
  await until(() => host.room.status().votes.ready.n === 1 && guest.room.status().votes.ready.mine, 'tally + echo');
  host.room.vote('ready');
  await until(() => host.autos.length === 1, 'countdown'); assert.deepEqual(host.autos, ['ready']);
  assert.deepEqual(guest.autos, []);
  assert.equal(host.room.start(), true); assert.equal(host.room.status().votes.ready.n, 0, 'starting clears the votes');
});
