const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function playing(t, opts = {}) {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844, ...opts });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  host.run('startRun()'); guest.run('startRun({ sync: true })');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  guest.run('G.mode = "play"; input.usingTouch = true; layoutTouch()');
  const sent = [];
  const real = guest.net.emote.bind(guest.net);
  guest.net.emote = (id) => { sent.push(id); return real(id); };
  return { hub, host, guest, sent };
}
const down = (c, x, y, id = 1, pointerType = 'touch') => c.dispatch('game', 'pointerdown', { pointerType, pointerId: id, clientX: x, clientY: y });
// centre of a view-px rect, in CSS px
const centre = (c, r) => { const k = c.run('emoteLayout().k'); return [(r.x + r.w / 2) * k, (r.y + r.h / 2) * k]; };

test('holding the jump button never opens anything and never sends an emote', async (t) => {
  const { guest, sent } = await playing(t);
  const jumpX = 390 * 0.74, jumpY = 780;                          // the jump zone: right half, low
  down(guest, jumpX, jumpY);
  assert.equal(guest.run('input.jumpHeld'), true, 'the press is a jump');
  for (let i = 0; i < 120; i++) guest.run('netTick(STEP)');       // two seconds of holding, longer than the old 400 ms long-press
  guest.run('G.player.onGround = false; G.player.vy = -3');       // airborne, the moment the old wheel used to flash in
  for (let i = 0; i < 60; i++) guest.run('netTick(STEP)');
  assert.equal(guest.run('emTray.open'), false);
  assert.deepEqual(sent, []);
  assert.equal(guest.run('input.jumpHeld'), true, 'and the jump is still held');
});

test('the emote button opens a tray, a tap on an emote sends it, and neither is ever a jump', async (t) => {
  const { guest, sent } = await playing(t);
  const L = guest.run('emoteLayout()');
  const [bx, by] = centre(guest, L.button);
  down(guest, bx, by, 1);
  assert.equal(guest.run('emTray.open'), true, 'tapping the button opens the tray');
  assert.equal(guest.run('input.jumpHeld || input.jumpPressed'), false, 'the tap was not a jump');
  const [ex, ey] = centre(guest, L.items[3]);
  down(guest, ex, ey, 2);
  assert.deepEqual(sent, [3], 'the heart went out');
  assert.equal(guest.run('emTray.open'), false, 'and the tray tidied itself away');
  assert.equal(guest.run('input.jumpHeld || input.jumpPressed'), false, 'still no jump');
  assert.equal(guest.run('selfEmote.id'), 3, 'you see your own emote');
});

test('a press anywhere else closes the tray and is still a normal press: a jump is a jump', async (t) => {
  const { guest, sent } = await playing(t);
  const L = guest.run('emoteLayout()');
  down(guest, ...centre(guest, L.button), 1);
  assert.equal(guest.run('emTray.open'), true);
  down(guest, 390 * 0.74, 780, 2);                                // the jump zone
  assert.equal(guest.run('emTray.open'), false);
  assert.equal(guest.run('input.jumpHeld'), true, 'the jump went through');
  assert.deepEqual(sent, []);
});

test('the tray puts itself away after a few seconds and when you die', async (t) => {
  const { guest } = await playing(t);
  const L = guest.run('emoteLayout()');
  down(guest, ...centre(guest, L.button), 1);
  assert.equal(guest.run('emTray.open'), true);
  guest.run('emTray.at = performance.now() - 4100; netTick(STEP)');
  assert.equal(guest.run('emTray.open'), false, 'timed out');
  down(guest, ...centre(guest, L.button), 2);
  assert.equal(guest.run('emTray.open'), true);
  guest.run('G.player.dead = true; netTick(STEP)');
  assert.equal(guest.run('emTray.open'), false, 'a death closes it (the death card has its own row)');
});

test('the button is only there for a live, playing runner with emotes on', async (t) => {
  const { guest } = await playing(t);
  assert.equal(guest.run('emoteAvailable()'), true);
  guest.run('settings.netEmotes = false');
  assert.equal(guest.run('emoteAvailable()'), false, 'switched off in settings');
  guest.run('settings.netEmotes = true; G.player.dead = true');
  assert.equal(guest.run('emoteAvailable()'), false, 'dead');
  guest.run('G.player.dead = false; G.mode = "attract"');
  assert.equal(guest.run('emoteAvailable()'), false, 'not in a run');
  const solo = client(relay());
  t.after(() => solo.close());
  solo.run('startRun(); G.mode = "play"');
  assert.equal(solo.run('emoteAvailable()'), false, 'never in solo play');
});

test('the layout keeps every emote on screen and finger-sized, clear of the strip and the notch, at any size', async (t) => {
  for (const [w, h] of [[320, 568], [390, 844], [844, 390], [667, 375], [820, 1180], [1440, 900]]) {
    const c = client(relay(), { width: w, height: h });
    t.after(() => c.close());
    c.run(`view.w = ${w}; view.h = ${h}`);
    const L = c.run('emoteLayout()');
    const k = L.k, stripBottom = 12 + 26;
    assert.ok(L.button.y >= stripBottom, `${w}x${h}: the button sits under the race strip`);
    assert.ok(L.button.x + L.button.w <= w - 12 + 1e-6, `${w}x${h}: and inside the right margin`);
    assert.ok(L.button.w * k >= 40 - 1e-6, `${w}x${h}: 40 CSS px button`);
    assert.equal(L.items.length, 6);
    for (const it of L.items) {
      assert.ok(it.x >= 0 && it.x + it.w <= w && it.y + it.h <= h, `${w}x${h}: emote ${it.i} is on screen`);
      assert.ok(it.w * k >= 36 - 1e-6, `${w}x${h}: emote ${it.i} is at least 36 CSS px`);
    }
    const [a, b] = [L.items[0], L.items[1]];
    assert.ok(b.x >= a.x + a.w, `${w}x${h}: emotes don't overlap`);
    if (w >= 390) assert.ok(L.items[0].w * k >= 44 - 1e-6, `${w}x${h}: full 44 CSS px targets when there is room`);
  }
});
