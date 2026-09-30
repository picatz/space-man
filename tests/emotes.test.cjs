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
  const { hub, guest, sent } = await playing(t);
  const jumpX = 390 * 0.74, jumpY = 780;                          // the jump zone: right half, low
  down(guest, jumpX, jumpY);
  assert.equal(guest.run('input.jumpHeld'), true, 'the press is a jump');
  const t0 = guest.run('performance.now()');
  for (let i = 0; i < 30; i++) { hub.advance(100); guest.run('netTick(STEP)'); }   // 3 s on the real clock, far past the old 400 ms long-press
  assert.ok(guest.run('performance.now()') - t0 >= 3000, 'the clock really advanced');
  assert.equal(guest.run('emTray.open'), false, 'grounded, still holding');
  guest.run('G.player.onGround = false; G.player.vy = -3');       // airborne: the moment the old wheel used to flash in
  for (let i = 0; i < 30; i++) { hub.advance(100); guest.run('netTick(STEP)'); }
  assert.equal(guest.run('emTray.open'), false, 'airborne, still holding');
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

test('a spectator never gets the button, even mid-run', async (t) => {
  const hub = relay(), host = client(hub), watcher = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); watcher.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await watcher.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1, role: 1 });
  await until(() => watcher.net.roster().length === 2, 'complete roster');
  watcher.run('G.mode = "play"; G.player.dead = false');
  assert.equal(watcher.net.info().role, 1, 'joined as a spectator');
  assert.equal(watcher.run('netSpectating()'), true);
  assert.equal(watcher.run('emoteAvailable()'), false, 'no button for a spectator');
  down(watcher, 300, 60);                                        // a press where the button would be does nothing
  assert.equal(watcher.run('emTray.open'), false);
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

test('the layout keeps every emote on screen and finger-sized, clear of the strip and the notch, at any real size', async (t) => {
  const cases = [                                    // [css w, css h, safe insets]
    [320, 568, { top: 0, left: 0, right: 0, bottom: 0 }],
    [390, 844, { top: 47, left: 0, right: 0, bottom: 34 }],       // notched phone, portrait
    [844, 390, { top: 0, left: 47, right: 47, bottom: 21 }],      // the same phone on its side
    [667, 375, { top: 0, left: 0, right: 0, bottom: 0 }],
    [820, 1180, { top: 24, left: 0, right: 0, bottom: 20 }],
    [1440, 900, { top: 0, left: 0, right: 0, bottom: 0 }],
  ];
  for (const [w, h, ins] of cases) {
    const c = client(relay(), { width: w, height: h });
    t.after(() => c.close());
    c.context.getComputedStyle = () => ({ getPropertyValue: (n) => String(ins[n.replace('--sa-', '')] || 0) });
    c.run('resize()');                               // the real portrait/landscape view for this window
    const L = c.run('emoteLayout()'), k = L.k, tag = `${w}x${h}`;
    assert.ok(Math.abs(k - w / c.run('view.w')) < 1e-9, tag + ': k is the real CSS-per-view scale');
    assert.ok(L.button.y >= 12 + ins.top + 26, tag + ': the button sits under the race strip');
    assert.ok((L.button.x + L.button.w) * k <= w - ins.right - 8, `${tag}: inside the right margin and notch (${(L.button.x + L.button.w) * k} vs ${w - ins.right})`);
    assert.ok(L.button.w * k >= 40 - 1e-6, tag + ': 40 CSS px button');
    assert.equal(L.items.length, 6);
    for (const it of L.items) {
      assert.ok(it.x * k >= ins.left && (it.x + it.w) * k <= w - ins.right && (it.y + it.h) * k <= h, `${tag}: emote ${it.i} is on screen and clear of the notch`);
      assert.ok(it.w * k >= 36 - 1e-6, `${tag}: emote ${it.i} is at least 36 CSS px`);
    }
    const [a, b] = [L.items[0], L.items[1]];
    assert.ok(b.x >= a.x + a.w, tag + ": emotes don't overlap");
    if (w >= 390) assert.ok(L.items[0].w * k >= 44 - 1e-6, tag + ': full 44 CSS px targets when there is room');
  }
});

test('a first touch on the emote button still hands the HUD to touch and unlocks sound, without jumping', async (t) => {
  const { guest } = await playing(t);
  guest.run('input.usingTouch = false; input.usingKeys = true; globalThis.__resumed = 0; Audio.resume = () => { __resumed++; }');
  down(guest, ...centre(guest, guest.run('emoteLayout()').button), 1);
  assert.equal(guest.run('input.usingTouch'), true, 'touch controls follow the finger');
  assert.equal(guest.run('input.usingKeys'), false);
  assert.equal(guest.run('__resumed'), 1, 'suspended audio is resumed by the tap');
  assert.equal(guest.run('input.jumpHeld || input.jumpPressed'), false, 'and it was not a jump');
  down(guest, ...centre(guest, guest.run('emoteLayout()').button), 2, 'mouse');
  assert.equal(guest.run('input.usingTouch'), false, 'a mouse click on it hands the HUD back to the mouse');
});

test('in an unstable room the tray sits below the LEAVE banner, so an emote never leaves the room', async (t) => {
  const { guest, sent } = await playing(t);
  guest.net._n1.session().unstable = true;
  guest.run('drawUnstableBanner()');                               // the frame draws the banner, which publishes its hit area
  const hit = guest.run('_unstableHit');
  assert.ok(hit, 'the banner is up');
  const L = guest.run('emoteLayout()');
  assert.ok(L.tray.y * L.k >= hit.y1, 'the tray starts below the banner target');
  const before = guest.net.active;
  down(guest, ...centre(guest, L.button), 1);                      // open the tray
  down(guest, ...centre(guest, L.items[0]), 2);                    // its first emote, the one nearest the banner
  assert.deepEqual(sent, [0], 'the emote went out');
  assert.equal(guest.net.active, before, 'and the room was not left');
});
