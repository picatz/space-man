// Review round 5 on PR #17: host quality events, per-row snapshot refresh, non-colour link cue.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { client, relay, until } = require('./harness.cjs');

async function room(t, guestGame = false) {
  const hub = relay(), host = client(hub), guest = client(hub, { game: guestGame });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'roster');
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  clearInterval(hs.snapTimer); clearInterval(gs.pingTimer);
  return { hub, host, guest, hs, gs, row: [...hs.roster.values()][0] };
}

test('the host announces a member\'s link as soon as its report arrives, so the room card can show it', async (t) => {
  const { host, guest, hs, gs } = await room(t);
  const events = [];
  host.net.onEvent((e, d) => { if (e === 'quality') events.push(d); });
  const F = guest.net._n1.frames;
  await hs._onPacket(gs.keys.pub, await guest.net._n1.env.sealApp(gs.pair, F.encPing(F.makeScratch(), 50, 80, 0, 8).slice()));
  assert.ok(events.length >= 1, 'a quality event after the report');
  assert.equal(events.at(-1).peers.length, 1);
  assert.equal(events.at(-1).peers[0].rttMs, 80);
  // The room card, open since the join, now carries the member's link.
  host.run('renderRoomCard = ((f) => function () { globalThis.__renders = (globalThis.__renders || 0) + 1; return f.apply(this, arguments); })(renderRoomCard); showOverlay("ovRoom")');
  await hs._onPacket(gs.keys.pub, await guest.net._n1.env.sealApp(gs.pair, F.encPing(F.makeScratch(), 51, 400, 0.2, 8).slice()));
  assert.ok(host.run('globalThis.__renders') >= 1, 'the open room card re-rendered on the quality change');
});

test('in a full room every live runner is re-sent within the heartbeat, even when nothing changes', async (t) => {
  const { hub, host, guest, hs, gs } = await room(t);
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const fakes = [];
  for (let p = 3; p <= 32; p++) {
    const r = { p, pub: new Uint8Array(32).fill(p), role: 0, absent: false, lastSeen: 0, pair: host.net._n1.env.makePair(key, hs.roomId, 0, 2), strikes: 0,
      pres: { t: 10, x: 100 + p, y: 250, vx: 0, vy: 0, state: 11, chain: 0, score: 0, dist: 0, runId: hs.runId } };
    hs.roster.set('fake' + p, r); fakes.push(r);
  }
  const seen = new Map();                                  // p -> guest arrival times (hub clock)
  const last = new Map(), tick = { i: 0 };
  const record = () => { for (const r of fakes) { const q = gs.peers.get(r.p); if (q && q.receivedAt !== last.get(r.p)) { last.set(r.p, q.receivedAt); if (!seen.has(r.p)) seen.set(r.p, []); seen.get(r.p).push(tick.i * 100); } } };
  for (let i = 0; i < 50; i++) {                           // 5 s of 10 Hz ticks; runners "fresh" but unchanged
    const now = host.run('performance.now()');
    for (const r of fakes) r.lastSeen = now;
    await hs._snapTick();
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 5)); record(); tick.i++;
    hub.advance(100);
  }
  await new Promise((r) => setTimeout(r, 30));
  let worst = 0;
  for (const r of fakes) {
    const all = seen.get(r.p) || [];
    assert.ok(all.length >= 3, 'P' + r.p + ' refreshed ' + all.length + ' times');
    for (let i = 1; i < all.length; i++) worst = Math.max(worst, all[i] - all[i - 1]);
  }
  t.diagnostic('longest gap between refreshes of one runner: ' + worst + ' ms');
  assert.ok(worst <= 1100, 'every runner refreshed within the heartbeat (worst ' + worst + ' ms, receivers expire at 2500)');
});

test('each member\'s link level is readable as text, not colour alone', async (t) => {
  const { host, row } = await room(t, false);
  row.link = { n: 1, rtt: 420, loss: 0.12, jit: 30 };
  host.run('renderRoomCard()');
  const dot = host.elements.get('roomRoster').children.flatMap((r) => r.children).find((s) => /\bq-poor\b/.test(s.className || ''));
  assert.ok(dot, 'the member row carries its link cue');
  assert.match(dot.textContent, /Poor/, 'the level is in the visible text: ' + dot.textContent);
  assert.match(dot.textContent, /420/);
  assert.match(dot.attrs?.['aria-label'] || '', /Poor link.*420/);
});
