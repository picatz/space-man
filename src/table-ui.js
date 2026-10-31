/* Space Man · Constellations
   A two-pilot duel on a Prism star chart. Rules live in src/tabletop.js and
   Play Together in src/table-room.js; this file is presentation only. Lazy:
   no DOM, listeners, frames, storage or audio before open().

   The board is a canvas for the art and nine real buttons laid over its
   stars, so touch, pointer, keyboard (arrows, 1-9, Enter), screen readers
   and the gamepad focus ring all act on the same controls. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const back = t => { t = clamp(t, 0, 1); const s = 1.7; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
  // Seat colours are a colour-blind safe pair (cyan / amber), and each seat has its own star shape.
  const SEATS = [null,
    Object.freeze({ color: '#38E1FF', light: '#CFF7FF', glow: '#9FF1FF', shape: 'round', word: 'cyan round' }),
    Object.freeze({ color: '#FFB454', light: '#FFE6BF', glow: '#FFD08A', shape: 'spark', word: 'amber five-pointed' })];
  // Rivals are friends (docs/art-direction.md): Flare wears her amber and a bright, friendly look.
  const RIVAL = Object.freeze({ name: 'Flare', appearance: Object.freeze({ v: 1, suit: 'gold', hat: 'none', eyes: 'bright', helmet: 'round', detail: 'plain', ship: 'comet' }) });
  const FRIEND = Object.freeze({ v: 1, suit: 'mint', hat: 'none', eyes: 'happy', helmet: 'round', detail: 'plain', ship: 'comet' });
  const LEVELS = Object.freeze([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]);
  const REGION = Object.freeze({ skyTop: '#12152B', horizon: '#2B2A4A', accent: '#B4A6E8' });
  const ROUND_PAUSE_MS = 2200;
  // Reading-order stars, so the number keys and screen readers agree with the picture.
  const SPOT = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];

  const STYLES = `
.tt-root{position:fixed;inset:0;z-index:1000;isolation:isolate;overflow:hidden;background:linear-gradient(180deg,${REGION.skyTop},${REGION.horizon});color:#E4E9FF;font-family:var(--sm-font-body,ui-rounded,system-ui,sans-serif);font-size:14px;line-height:1.4;-webkit-user-select:none;user-select:none;color-scheme:dark;
  --tt-top:env(safe-area-inset-top,0px);--tt-right:env(safe-area-inset-right,0px);--tt-bottom:env(safe-area-inset-bottom,0px);--tt-left:env(safe-area-inset-left,0px)}
.tt-root[hidden],.tt-root [hidden]{display:none!important}
.tt-root *,.tt-root *:before,.tt-root *:after{box-sizing:border-box}
.tt-root :focus-visible{outline:3px solid #FFE59A;outline-offset:2px}
.tt-root button{-webkit-tap-highlight-color:transparent;font-family:inherit}
.tt-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.tt-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;margin:0;padding:12px 18px;border:1px solid #B4A6E844;border-radius:14px;background:#221F3D;color:#ECEBFF;font-size:15px;font-weight:750;line-height:1.2;text-align:center;cursor:pointer;box-shadow:inset 0 1px 0 #ffffff14,0 6px 16px #0005;transition:transform .14s,background .14s,border-color .14s}
.tt-btn:active{transform:translateY(1px) scale(.98)}
.tt-btn.primary{background:linear-gradient(180deg,#FFD27A,#FFB454);border-color:#FFE2A8;color:#2A1606}
.tt-btn.ghost{background:#B4A6E812;border-color:#B4A6E833}
.tt-btn:disabled{opacity:.55;cursor:default}
@media (hover:hover){.tt-btn:hover:not(:disabled){border-color:#E8E1FF;background:#2E2A52}.tt-btn.primary:hover:not(:disabled){background:linear-gradient(180deg,#FFDE96,#FFC06A)}}
.tt-lobby{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:calc(10px + var(--tt-top)) calc(16px + var(--tt-right)) calc(18px + var(--tt-bottom)) calc(16px + var(--tt-left))}
.tt-lobby-inner{width:100%;max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.tt-head{display:flex;align-items:center;gap:10px;min-height:48px}
.tt-back{min-width:48px;min-height:48px;padding:0 14px;border-radius:12px;border:1px solid #B4A6E833;background:#B4A6E812;color:#ECEBFF;font-size:14px;font-weight:700;cursor:pointer}
.tt-kicker{margin:0;color:#B4A6E8;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
.tt-title{margin:0;font-family:var(--sm-font-display,inherit);font-size:28px;line-height:1.05;font-weight:850;letter-spacing:-.02em;color:#FFF6E6}
.tt-hero{display:block;width:100%;height:auto;aspect-ratio:520/220;border-radius:18px;background:#0D0F22;box-shadow:inset 0 0 0 1px #B4A6E826}
.tt-rules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0;padding:0;list-style:none}
.tt-rules li{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px 12px;border-radius:14px;background:#0E1026aa;box-shadow:inset 0 0 0 1px #B4A6E81f;text-align:center;font-size:12px;line-height:1.3;color:#D8D6F2}
.tt-rules canvas{width:64px;height:64px}
.tt-rules b{color:#FFF6E6}
.tt-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:18px;background:#0E1026cc;box-shadow:inset 0 0 0 1px #B4A6E826}
.tt-card h2{margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#B4A6E8}
.tt-row{display:flex;gap:8px;flex-wrap:wrap}.tt-row>.tt-btn{flex:1 1 140px}
.tt-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:4px;border-radius:14px;background:#06071499}
.tt-seg button{min-height:44px;border-radius:10px;border:1px solid transparent;background:transparent;color:#C9C6E8;font-size:14px;font-weight:700;cursor:pointer}
.tt-seg button[aria-pressed=true]{background:#2E2A52;border-color:#B4A6E866;color:#FFF6E6}
.tt-note{margin:0;font-size:12px;color:#A9A6CC}
.tt-error{margin:0;font-size:13px;color:#FFB8A6}
.tt-hud{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:8px;padding:calc(8px + var(--tt-top)) calc(12px + var(--tt-right)) 0 calc(12px + var(--tt-left));pointer-events:none}
.tt-hud>*{pointer-events:auto}
.tt-pause{min-width:48px;min-height:48px;border-radius:14px;border:1px solid #B4A6E833;background:#0E1026cc;color:#ECEBFF;font-size:13px;font-weight:800;cursor:pointer;padding:0 14px}
.tt-round{flex:1;font-family:var(--sm-font-display,inherit);text-align:center;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#B4A6E8}
.tt-hud-spacer{min-width:48px}
.tt-status{position:absolute;left:12px;right:12px;text-align:center;font-size:16px;font-weight:800;color:#FFF6E6;text-shadow:0 2px 10px #000a;pointer-events:none}
.tt-hint{position:absolute;left:16px;right:16px;text-align:center;font-size:13px;color:#C9C6E8;pointer-events:none}
.tt-cell{position:absolute;margin:0;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;touch-action:manipulation}
.tt-cell:disabled{cursor:default}
.tt-cell:focus-visible{outline:3px solid #FFE59A;outline-offset:-4px}
.tt-dialog-wrap{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:calc(16px + var(--tt-top)) 16px calc(16px + var(--tt-bottom));background:#05061399}
.tt-dialog{width:min(420px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:20px;border-radius:22px;background:linear-gradient(180deg,#24204A,#16142E);box-shadow:inset 0 0 0 1px #B4A6E840,0 20px 50px #000a;text-align:center}
.tt-dialog h2{margin:0;font-family:var(--sm-font-display,inherit);font-size:24px;line-height:1.15;color:#FFF6E6}
.tt-dialog p{margin:0;color:#D8D6F2}
.tt-dialog .tt-btn{width:100%}
.tt-score{font-size:34px;font-weight:850;letter-spacing:.04em;color:#FFF6E6}
.tt-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tt-root .sm-invite{margin:0}
/* Short landscape phones: rules and choices first, the hero art steps aside. */
@media (max-height:560px){.tt-hero{display:none}.tt-lobby-inner{max-width:760px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.tt-head,.tt-rules{grid-column:1/-1}}
@media (max-width:359px){.tt-title{font-size:24px}.tt-rules li{font-size:11px}.tt-rules canvas{width:52px;height:52px}}
`;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(text, cls, fn) { const n = el('button', 'tt-btn ' + (cls || ''), text); n.type = 'button'; if (fn) n.addEventListener('click', fn); return n; }

  /* ---- Painters. Glows are cached sprites; nothing allocates a gradient per frame. ---- */
  const sprites = new Map();
  function glowSprite(color) {
    if (sprites.has(color)) return sprites.get(color);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, color); grad.addColorStop(.35, color + '66'); grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128); sprites.set(color, c); return c;
  }
  function starfield(w, h, seed) {
    const c = document.createElement('canvas'), dpr = Math.min(2, root.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, REGION.skyTop); sky.addColorStop(1, REGION.horizon);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const rand = root.SpaceManTabletop.rng(seed);
    // Two soft prism nebulae and a scatter of stars, some with a cross glint.
    for (const [x, y, r, col] of [[.18, .2, .55, '#B4A6E8'], [.85, .78, .6, '#6A5BC8']]) { g.globalAlpha = .16; g.drawImage(glowSprite(col), w * x - w * r, h * y - w * r, w * r * 2, w * r * 2); }
    g.globalAlpha = 1;
    for (let i = 0; i < Math.round(w * h / 2600); i++) {
      const x = rand() * w, y = rand() * h, s = rand();
      g.fillStyle = s > .92 ? '#FFE6BF' : '#E4E0FF'; g.globalAlpha = .25 + s * .6;
      g.fillRect(x, y, s > .8 ? 2 : 1, s > .8 ? 2 : 1);
      if (s > .97) { g.globalAlpha = .35; g.fillRect(x - 4, y + .5, 9, 1); g.fillRect(x + .5, y - 4, 1, 9); }
    }
    g.globalAlpha = 1; return c;
  }
  // A lit star: a glowing core with light rays. Seat 1 is a round star with four soft rays, seat 2 a
  // classic five-pointed star, so the two read apart by shape as well as colour.
  function star(c, x, y, r, seat, { alpha = 1, lit = 1, flicker = 0 } = {}) {
    const s = SEATS[seat], on = lit > .5;
    c.save();
    c.globalAlpha = alpha * (.42 + .34 * lit - flicker * .25);
    c.drawImage(glowSprite(s.glow), x - r * 1.7, y - r * 1.7, r * 3.4, r * 3.4);
    c.globalAlpha = alpha * (.55 + .45 * lit - flicker * .3);
    c.fillStyle = on ? s.color : '#4A4560';
    if (s.shape === 'round') {
      // Four long, thin rays and a round body.
      for (const a of [0, Math.PI / 2]) {
        c.save(); c.translate(x, y); c.rotate(a);
        c.beginPath(); c.moveTo(-r * 1.12, 0); c.quadraticCurveTo(0, r * .14, r * 1.12, 0); c.quadraticCurveTo(0, -r * .14, -r * 1.12, 0); c.fill();
        c.restore();
      }
      c.beginPath(); c.arc(x, y, r * .62, 0, TAU); c.fill();
    } else {
      // A classic five-pointed star, point up.
      c.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, d = k % 2 ? r * .46 : r * 1.06; c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d + r * .06); }
      c.closePath(); c.fill();
    }
    // A white-hot centre, so a lit star reads as light rather than a flat token.
    c.globalAlpha = alpha * (.35 + .65 * lit - flicker * .35);
    c.fillStyle = s.light; c.beginPath(); c.arc(x, y, r * (s.shape === 'round' ? .36 : .26), 0, TAU); c.fill();
    c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x - r * .08, y - r * .08, r * .12, 0, TAU); c.fill();
    c.restore();
  }
  function socket(c, x, y, r, t, calm, hot) {
    c.save();
    const pulse = calm ? .5 : .5 + .5 * Math.sin(t * 1.6 + x * .05 + y * .03);
    c.globalAlpha = .22 + pulse * .12 + (hot ? .25 : 0);
    c.strokeStyle = '#D9D0FF'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, r * .78, 0, TAU); c.stroke();
    c.globalAlpha = .7 + (hot ? .3 : 0); c.fillStyle = '#EDE8FF';
    // An unlit star: a small dim point, so it never shares a shape with either seat's lit star.
    c.beginPath(); c.arc(x, y, r * (.12 + pulse * .03), 0, TAU); c.fill();
    c.restore();
  }
  function roundedRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function create(options) {
    const opts = options || {}, kit = root.SpaceManTabletop, game = kit.LANTERNS;
    let rootEl = null, canvas = null, ctx = null, lobbyEl = null, matchEl = null, dialogWrap = null, dialogEl = null, statusEl = null, hintEl = null, roundEl = null, live = null;
    let heroCanvas = null, levelButtons = [], friendCard = null, friendStatus = null, friendError = null, inviteCard = null, inviteLink = null, btnHost = null, btnShare = null, recordEl = null;
    let inertSiblings = [], cells = [], active = false, view = 'lobby', mode = null, level = 'normal', match = null, room = null, roomStatus = null;
    // Today's chart (mode 'daily'): { day, par, state } plus the tries spent and whether this attempt still counts.
    let daily = null;
    let raf = 0, width = 0, height = 0, dpr = 1, sky = null, layout = null, cursor = 4, hover = -1, keyNav = false;
    let anim = { placed: new Map(), gone: [], winAt: 0, roundAt: 0, shake: 0, fx: [] }, shown = null, cpuTimer = 0, nextTimer = 0, padPrev = {}, padRepeat = 0, audio = null, lastAnnounced = '';
    const listeners = [];
    const body = () => getComputedStyle(rootEl).fontFamily || 'system-ui, sans-serif';
    const display = () => (getComputedStyle(document.documentElement).getPropertyValue('--sm-font-display') || '').trim() || 'system-ui, sans-serif';
    const now = () => root.performance.now();
    const prefs = () => (typeof opts.settings === 'function' ? opts.settings() : {}) || {};
    const calm = () => !!(prefs().reduceMotion || prefs().batterySaver || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || (document.body && document.body.classList.contains('reduce-motion')));
    const buzz = kind => { if (typeof opts.buzz === 'function') try { opts.buzz(kind); } catch (_) {} };
    const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push(() => target.removeEventListener(type, fn, o)); };
    const store = {
      read() { try { return JSON.parse(root.localStorage.getItem(opts.storageKey || 'sm2.lanterns.v1')) || {}; } catch (_) { return {}; } },
      write(v) { try { root.localStorage.setItem(opts.storageKey || 'sm2.lanterns.v1', JSON.stringify(v)); } catch (_) {} },
    };

    /* ---- Who sits where ---- */
    function pilot(seat) {
      if (mode === 'online' && roomStatus) {
        const p = roomStatus.seats[seat - 1], row = p && roomStatus.roster.find(r => r.p === p);
        if (!row) return { name: seat === 2 ? 'Waiting…' : 'Host', appearance: seat === 2 ? FRIEND : RIVAL.appearance, empty: !row, you: false };
        return { name: row.you ? 'You' : row.callsign || 'Pilot ' + p, appearance: row.appearance || (seat === 1 ? null : FRIEND), you: !!row.you };
      }
      const mine = typeof opts.appearance === 'function' ? opts.appearance() : null;
      if (mode === 'pass') return seat === 1 ? { name: 'Pilot 1', appearance: mine } : { name: 'Pilot 2', appearance: FRIEND };
      return seat === 1 ? { name: 'You', appearance: mine, you: true } : { name: RIVAL.name, appearance: RIVAL.appearance, cpu: true };
    }
    const current = () => (mode === 'online' ? roomStatus && roomStatus.match : match);
    function canAct(seat) {
      const m = current();
      if (!m || m.phase !== 'playing' || game.turn(m.state) !== seat) return false;
      if (mode === 'solo' || mode === 'daily') return seat === 1;
      if (mode === 'pass') return true;
      return !!roomStatus && roomStatus.mySeat === seat && !roomStatus.connection && !!roomStatus.seats[1];
    }

    /* ---- Audio: three tiny voices, synthesised, quiet and optional. ---- */
    function tone(freqs, { type = 'sine', dur = .16, gap = .07, vol = .12, slide = 0 } = {}) {
      const p = prefs();
      if (p.muted || p.sfx === false) return;
      try {
        if (!audio) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return; audio = new A(); }
        if (audio.state === 'suspended') audio.resume().catch(() => {});
        const t0 = audio.currentTime + .01, level = clamp(p.sfxVol === undefined ? .7 : p.sfxVol, 0, 1) * vol;
        freqs.forEach((f, i) => {
          const o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * gap;
          o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
          o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + .02);
        });
      } catch (_) {}
    }
    const sfx = {
      light: seat => tone(seat === 1 ? [784, 1175] : [587, 880], { dur: .22, gap: .05 }),
      dark: () => tone([392], { type: 'triangle', dur: .3, vol: .07, slide: .5 }),
      win: seat => tone(seat === 1 ? [659, 784, 988, 1319] : [523, 659, 784, 1047], { dur: .26, gap: .09, vol: .1 }),
      lose: () => tone([494, 392, 330], { type: 'triangle', dur: .3, gap: .12, vol: .08 }),
      chart: () => tone([523, 659, 784, 1047, 1319, 1568], { dur: .34, gap: .1, vol: .1 }),
      move: () => tone([1320], { dur: .05, vol: .03 }),
    };
    function announce(text) { if (live && text && text !== lastAnnounced) { lastAnnounced = text; live.textContent = text; } }

    /* ---- DOM ---- */
    function build() {
      if (!document.getElementById('tt-style')) { const s = el('style'); s.id = 'tt-style'; s.textContent = STYLES; document.head.appendChild(s); }
      rootEl = el('div', 'tt-root'); rootEl.hidden = true; rootEl.setAttribute('role', 'application'); rootEl.setAttribute('aria-label', 'Constellations');
      canvas = el('canvas', 'tt-canvas'); canvas.setAttribute('aria-hidden', 'true'); ctx = canvas.getContext('2d');
      live = el('div', 'tt-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      // Lobby
      lobbyEl = el('div', 'tt-lobby');
      const inner = el('div', 'tt-lobby-inner');
      const head = el('div', 'tt-head'), backBtn = el('button', 'tt-back', '‹ Home'); backBtn.type = 'button'; backBtn.addEventListener('click', () => close());
      const titles = el('div'); titles.append(el('p', 'tt-kicker', 'Prism star chart · 2 pilots'), el('h1', 'tt-title', 'Constellations'));
      head.append(backBtn, titles);
      heroCanvas = el('canvas', 'tt-hero'); heroCanvas.width = 1040; heroCanvas.height = 440; heroCanvas.setAttribute('role', 'img');
      heroCanvas.setAttribute('aria-label', 'You and Flare face each other across a three by three star chart.');
      const rules = el('ol', 'tt-rules'); rules.setAttribute('aria-label', 'How to play');
      for (const [i, html] of [[0, '<b>Light</b> any dark star.'], [1, 'Keep <b>three</b> lit. Your fourth lets the <b>oldest</b> fade.'], [2, '<b>Three in a line</b> makes a constellation. First to two.']]) {
        const li = el('li'), c = el('canvas'); c.width = c.height = 128; c.setAttribute('aria-hidden', 'true'); c.dataset.rule = String(i);
        const p = el('span'); p.innerHTML = html; li.append(c, p); rules.append(li);
      }
      const solo = el('section', 'tt-card'); solo.setAttribute('aria-labelledby', 'ttSoloTitle');
      const soloTitle = el('h2', '', 'Duel Flare'); soloTitle.id = 'ttSoloTitle';
      const seg = el('div', 'tt-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'How sharp is Flare');
      levelButtons = LEVELS.map(([id, name]) => { const b = el('button', '', name); b.type = 'button'; b.dataset.level = id; b.addEventListener('click', () => { level = id; syncLobby(); store.write(Object.assign(store.read(), { level })); }); seg.append(b); return b; });
      const play = button('Play Flare', 'primary', () => startLocal('solo')); play.id = 'ttPlayCpu';
      recordEl = el('p', 'tt-note');
      solo.append(soloTitle, seg, play, recordEl);
      const together = el('section', 'tt-card'); together.setAttribute('aria-labelledby', 'ttFriendsTitle');
      const togetherTitle = el('h2', '', 'With a friend'); togetherTitle.id = 'ttFriendsTitle';
      const row = el('div', 'tt-row');
      const pass = button('Pass and play', 'ghost', () => startLocal('pass')); pass.id = 'ttPass';
      btnHost = button('Play a friend online', 'ghost', () => hostRoom()); btnHost.id = 'ttHost';
      row.append(pass, btnHost);
      friendCard = el('div'); friendCard.hidden = true; friendCard.style.display = 'flex'; friendCard.style.flexDirection = 'column'; friendCard.style.gap = '10px';
      friendStatus = el('p', 'tt-note'); friendStatus.setAttribute('role', 'status');
      inviteCard = root.SpaceManRoomInvite ? root.SpaceManRoomInvite.create({ document, game: 'Constellations table' }) : null;
      inviteLink = '';
      btnShare = button('Share invite link', 'ghost', async () => {
        try { if (root.navigator.share) await root.navigator.share({ title: 'Space Man · Constellations', url: inviteLink }); else { await root.navigator.clipboard.writeText(inviteLink); friendStatus.textContent = 'Invite copied. Send it to your friend.'; } } catch (_) {}
      });
      const leave = button('Close table', 'ghost', () => { if (room) room.close(); mode = null; syncLobby(); });
      friendCard.append(friendStatus);
      if (inviteCard) friendCard.append(inviteCard.el);
      const friendRow = el('div', 'tt-row'); friendRow.append(btnShare, leave); friendCard.append(friendRow);
      friendError = el('p', 'tt-error'); friendError.hidden = true; friendError.setAttribute('role', 'alert');
      together.append(togetherTitle, row, el('p', 'tt-note', 'Pass one screen between two pilots, or send a code or QR to a friend on any phone, tablet or computer.'), friendCard, friendError);
      inner.append(head, heroCanvas, rules, solo, together);
      lobbyEl.append(inner);
      // Match
      matchEl = el('div'); matchEl.hidden = true;
      const hud = el('div', 'tt-hud'), pause = el('button', 'tt-pause', 'Menu'); pause.type = 'button'; pause.setAttribute('aria-label', 'Menu'); pause.addEventListener('click', () => openMenu());
      roundEl = el('div', 'tt-round'); hud.append(pause, roundEl, el('span', 'tt-hud-spacer'));
      statusEl = el('div', 'tt-status'); hintEl = el('div', 'tt-hint');
      const board = el('div'); board.setAttribute('role', 'grid'); board.setAttribute('aria-label', 'Star chart');
      for (let r = 0; r < 3; r++) {
        const rowEl = el('div'); rowEl.setAttribute('role', 'row'); rowEl.style.display = 'contents';
        for (let col = 0; col < 3; col++) {
          const i = r * 3 + col, b = el('button', 'tt-cell'); b.type = 'button'; b.dataset.cell = String(i); b.setAttribute('role', 'gridcell'); b.tabIndex = i === cursor ? 0 : -1;
          b.addEventListener('click', () => choose(i));
          b.addEventListener('focus', () => { cursor = i; syncCells(); });
          b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hover = i; });
          b.addEventListener('pointerleave', () => { if (hover === i) hover = -1; });
          cells.push(b); rowEl.append(b);
        }
        board.append(rowEl);
      }
      matchEl.append(hud, statusEl, board, hintEl);
      dialogWrap = el('div', 'tt-dialog-wrap'); dialogWrap.hidden = true; dialogEl = el('div', 'tt-dialog'); dialogEl.setAttribute('role', 'dialog'); dialogEl.setAttribute('aria-modal', 'true'); dialogWrap.append(dialogEl);
      rootEl.append(canvas, lobbyEl, matchEl, dialogWrap, live);
      document.body.appendChild(rootEl);
      const saved = store.read(); if (LEVELS.some(([id]) => id === saved.level)) level = saved.level;
    }
    function syncLobby() {
      for (const b of levelButtons) b.setAttribute('aria-pressed', String(b.dataset.level === level));
      const rec = store.read().wins || {}, w = rec[level] || 0;
      recordEl.textContent = w ? 'You have beaten Flare ' + w + (w === 1 ? ' time' : ' times') + ' on ' + level + '.' : level === 'easy' ? 'Flare plays loose. A good first chart.' : level === 'normal' ? 'Flare plans a move or two ahead.' : 'Flare sees the whole chart. Good luck.';
      const s = room ? room.status() : null, hosting = !!(s && (s.active || s.busy) && mode === 'online');
      friendCard.hidden = !hosting; btnHost.disabled = hosting;
      if (s) {
        const link = s.host && s.info && typeof s.info.link === 'string' ? s.info.link : '';
        inviteLink = link; btnShare.hidden = !link;
        if (inviteCard) inviteCard.set(link, s.info && s.info.joinCode);
        friendStatus.textContent = s.busy ? (s.joinText || 'Opening a table…') : s.active ? (s.host ? 'Your table is open. The first friend to join sits opposite you.' : 'Joined. Waiting for the host…') : '';
        const err = s.error || s.closedReason; friendError.hidden = !err; friendError.textContent = err || '';
      }
    }

    /* ---- Lifecycle ---- */
    function open() {
      if (active) return true;
      if (!rootEl) build();
      active = true; rootEl.hidden = false; view = 'lobby'; showView();
      // The home screen behind the table is out of reach for focus, taps and screen readers until we close.
      inertSiblings = Array.from(document.body.children).filter(n => n !== rootEl && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)).map(n => ({ node: n, inert: n.inert }));
      for (const { node } of inertSiblings) node.inert = true;
      on(root, 'resize', resize); on(root, 'keydown', onKey, true); on(rootEl, 'pointerdown', () => { keyNav = false; }, true);
      if (root.visualViewport) on(root.visualViewport, 'resize', resize);
      resize(); syncLobby(); drawLobbyArt();
      raf = root.requestAnimationFrame(frame);
      try { lobbyEl.querySelector('#ttPlayCpu').focus({ preventScroll: true }); } catch (_) {}
      return true;
    }
    function close() {
      if (!active) return;
      clearTimers();
      if (room) room.close();
      active = false; mode = null; match = null; roomStatus = null; shown = null; rootEl.hidden = true; dialogWrap.hidden = true;
      for (const { node, inert } of inertSiblings) node.inert = inert; inertSiblings = [];
      if (raf) root.cancelAnimationFrame(raf); raf = 0;
      while (listeners.length) listeners.pop()();
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    function clearTimers() { root.clearTimeout(cpuTimer); root.clearTimeout(nextTimer); cpuTimer = nextTimer = 0; }
    function showView() {
      lobbyEl.hidden = view !== 'lobby'; matchEl.hidden = view !== 'match'; rootEl.dataset.screen = view;
      // A calm lobby stops the frame loop; the board always needs one.
      if (active && !raf) raf = root.requestAnimationFrame(frame);
      if (view === 'lobby') { dialogWrap.hidden = true; syncLobby(); }
    }
    function resize() {
      if (!active) return;
      const r = rootEl.getBoundingClientRect();
      width = Math.max(1, Math.round(r.width)); height = Math.max(1, Math.round(r.height)); dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      sky = starfield(width, height, 7);
      const probe = getComputedStyle(rootEl), inset = n => parseFloat(probe.getPropertyValue(n)) || 0;
      const top = inset('--tt-top') + 64, bottom = inset('--tt-bottom') + 18, wide = width > height * 1.15;
      // Portrait: pilots above the chart. Landscape: pilots either side of it.
      const pilots = wide ? 0 : clamp(height * .17, 92, 150), status = 44, hint = 40;
      const side = Math.floor(clamp(Math.min(wide ? width - 2 * clamp(width * .2, 140, 260) : width - 32, height - top - bottom - pilots - status - hint), 180, 620));
      // The pilots, the turn line and the chart travel as one block, centred in the free height.
      const slack = Math.max(0, height - top - bottom - pilots - status - hint - side), lift = wide ? slack / 2 : slack * .4;
      const bx = Math.round((width - side) / 2), by = Math.round(top + pilots + status + lift);
      layout = { wide, side, bx, by, step: side / 3, top, pilots, statusY: by - status + 6, hintY: by + side + 10,
        seatX: wide ? [0, bx / 2, width - bx / 2] : [0, width * .27, width * .73], seatY: wide ? by + side * .32 : top + 4 + lift };
      statusEl.style.top = layout.statusY + 'px'; hintEl.style.top = layout.hintY + 'px';
      for (let i = 0; i < 9; i++) {
        const b = cells[i], c = i % 3, rr = Math.floor(i / 3), size = layout.step * .86;
        b.style.width = b.style.height = size + 'px';
        b.style.left = (bx + (c + .5) * layout.step - size / 2) + 'px'; b.style.top = (by + (rr + .5) * layout.step - size / 2) + 'px';
      }
    }

    /* ---- Starting games ---- */
    function startLocal(kind) {
      clearTimers(); if (room && room.active) room.close();
      mode = kind; match = kit.startMatch(game, { seed: (Date.now() >>> 0) || 1, target: 2 });
      enterMatch();
    }
    function enterMatch() {
      view = 'match'; shown = null; anim = { placed: new Map(), gone: [], winAt: 0, roundAt: now(), shake: 0, fx: [] };
      dialogWrap.hidden = true; showView(); resize(); sync();
      try { cells[cursor].focus({ preventScroll: true }); } catch (_) {}
    }
    function ensureRoom() {
      if (room || !root.SpaceManTableRoom || !opts.net) return room;
      room = root.SpaceManTableRoom.create({ net: opts.net, build: opts.build, identity: opts.identity, baseUrl: opts.baseUrl, hostOptions: opts.hostOptions, game: game.id, onChange: roomChanged });
      return room;
    }
    async function hostRoom() {
      if (!active) open();
      if (!ensureRoom()) return false;
      if (room.active || room.busy) return !!room.active;
      mode = 'online'; view = 'lobby'; showView(); syncLobby();
      const ok = await room.hosting(); syncLobby(); return ok;
    }
    async function joinInvite(payload, role, resumeKey) {
      if (!active) open();
      if (!ensureRoom()) return false;
      mode = 'online'; syncLobby();
      const ok = await room.join(payload, role, true, resumeKey);
      if (ok) enterMatch(); else { view = 'lobby'; showView(); }
      return ok;
    }
    function roomChanged(status) {
      roomStatus = status;
      if (!active || mode !== 'online') return;
      if (!status.active && !status.busy) {
        if (view === 'match') { view = 'lobby'; mode = null; showView(); }
        syncLobby(); return;
      }
      // The host's lobby turns into the board the moment a rival sits down.
      if (view === 'lobby' && status.match) { enterMatch(); return; }
      if (view === 'lobby') syncLobby(); else sync();
    }

    /* ---- Moves ---- */
    function choose(i) {
      const m = current(); if (!m) return;
      const seat = game.turn(m.state);
      if (!canAct(seat)) { if (m.phase === 'playing') { buzz('select'); announce(statusText(m)); } return; }
      if (!game.moves(m.state).includes(i)) { buzz('select'); announce(SPOT[i] + ' is already lit.'); return; }
      if (mode === 'online') { room.play(i); return; }
      if (mode === 'daily' && !daily.practice && m.state.ply === daily.state.ply) {
        let rec = null;
        if (typeof opts.onDaily === 'function') try { rec = opts.onDaily('chart', { started: true }); } catch (_) {}
        if (rec && rec.chart) daily.tries = rec.chart.tries;
        daily.live = true;
      }
      match = kit.play(game, match, seat, i); sync();
    }
    function cpuTurn() {
      cpuTimer = 0;
      if ((mode !== 'solo' && mode !== 'daily') || !match || match.phase !== 'playing' || game.turn(match.state) !== 2) return;
      // On the daily chart Flare defends perfectly, so a line found is a line earned.
      const move = kit.bestMove(game, match.state, Object.assign({ seed: (match.seed ^ match.revision * 2654435761) >>> 0 }, kit.LEVELS[mode === 'daily' ? 'hard' : level]));
      match = kit.play(game, match, 2, move); sync();
    }
    // One place reacts to every change, local or from the host: diff what is on screen against the new match.
    function sync() {
      const m = current();
      if (!m) { renderStatus(); return; }
      const t = now(), before = shown, newRound = !before || before.round !== m.round || before.scores[0] + before.scores[1] > m.scores[0] + m.scores[1] || (before.phase !== 'playing' && m.phase === 'playing');
      if (newRound) {
        anim.placed.clear(); anim.gone = []; anim.winAt = 0; anim.roundAt = t;
        // The finished round's stars go out one after another, so a new round reads as a fresh chart, not a blink.
        if (before && before.round !== m.round) game.cells(before.state).forEach((seat, i) => { if (seat) anim.gone.push({ i, seat, t: t + i * 40 }); });
        if (before && dialogWrap.dataset.kind === 'over') hideDialog();
      }
      else if (before.revision !== m.revision) {
        const a = game.cells(before.state), b = game.cells(m.state);
        for (let i = 0; i < 9; i++) {
          if (b[i] && a[i] !== b[i]) { anim.placed.set(i, t); sfx.light(b[i]); buzz('light'); anim.fx.push({ kind: 'pickup', i, t, seat: b[i] }); }
          if (a[i] && !b[i]) { anim.gone.push({ i, seat: a[i], t }); sfx.dark(); }
        }
        if (m.result && !before.result) {
          anim.winAt = t;
          if (m.result.seat) { const mine = mode === 'online' ? roomStatus && roomStatus.mySeat === m.result.seat : mode === 'pass' || m.result.seat === 1; if (mine && m.phase === 'over') sfx.chart(); else (mine ? sfx.win : sfx.lose)(m.result.seat); buzz(!mine ? 'warn' : m.phase === 'over' ? 'celebrate' : 'success'); anim.shake = calm() ? 0 : .35; anim.fx.push({ kind: 'ko', i: m.result.line[1], t, seat: m.result.seat }); }
        }
      }
      shown = m;
      clearTimers();
      if (mode === 'daily' && dailyEnded(m)) { renderStatus(); syncCells(); return; }
      if (m.phase === 'playing' && (mode === 'solo' || mode === 'daily') && game.turn(m.state) === 2) cpuTimer = root.setTimeout(cpuTurn, 520 + (m.revision * 137 % 380));
      if (m.phase === 'round' && mode !== 'online') nextTimer = root.setTimeout(() => { match = kit.next(game, match); sync(); }, ROUND_PAUSE_MS);
      if (m.phase === 'over') { recordResult(m); showOver(m); }
      renderStatus(); syncCells();
    }
    /* ---- Daily chart ---- */
    const SpaceDaily = () => root.SpaceManDaily;
    // Your moves left in this attempt: par minus the stars you have lit since the chart was set.
    const dailyMovesLeft = m => daily.par - Math.ceil((m.state.ply - daily.state.ply) / 2);
    function startDaily(spec) {
      if (!spec || !spec.state) return false;
      if (!active) open();
      clearTimers(); if (room && room.active) room.close();
      daily = { day: spec.day, par: spec.par, state: spec.state, tries: spec.tries | 0, practice: !!spec.practice, live: false };
      mode = 'daily'; restartDaily(true);
      return true;
    }
    function restartDaily(first) {
      match = Object.freeze(Object.assign({}, kit.startMatch(game, { seed: 1, target: 1 }), { state: daily.state }));
      shown = null; if (first) enterMatch(); else { hideDialog(); sync(); try { cells[cursor].focus({ preventScroll: true }); } catch (_) {} }
      announce('Daily chart. Light a line in ' + daily.par + (daily.par === 1 ? ' move.' : ' moves.') + ' Your oldest star fades when you light a fourth.');
    }
    // The attempt is over when a line is lit or your moves run out; report it once and offer the next step.
    function dailyEnded(m) {
      const solved = m.phase !== 'playing' && m.result && m.result.seat === 1;
      if (!solved && m.phase === 'playing' && !(game.turn(m.state) === 1 && dailyMovesLeft(m) <= 0)) return false;
      if (dialogWrap.dataset.kind === 'daily') return true;
      let rec = null;
      const counted = !daily.practice && daily.live;
      if (counted && solved && typeof opts.onDaily === 'function') try { rec = opts.onDaily('chart', { solved: true }); } catch (_) {}
      daily.live = false;
      const D = SpaceDaily(), chartRec = rec && rec.chart;
      const out = !solved && counted && daily.tries >= D.CHART_TRIES, left = D.CHART_TRIES - daily.tries;
      if (solved || out) daily.practice = true;
      const ORD = ['', 'first', 'second', 'third'];
      const title = solved ? 'Chart solved!' : out ? 'Flare held the chart' : 'Not this time';
      const note = el('p', '', solved ? (chartRec && chartRec.solved ? 'Lit on your ' + ORD[chartRec.solved] + ' try. Share it, then see you tomorrow.' : 'Nicely lit. Practice runs never change your daily result.')
        : out ? 'Three tries spent. Tomorrow brings a new chart; keep practising this one if you like.'
        : !counted ? 'Flare found the block. Watch which of your stars fades next.'
        : 'Flare found the block. Watch which of your stars fades next. ' + left + (left === 1 ? ' try' : ' tries') + ' left today.');
      const actions = [];
      if (solved && typeof opts.onShareDaily === 'function') actions.push(button('Share today', 'primary', () => opts.onShareDaily()));
      actions.push(button(solved || out ? 'Practice this chart' : 'Try again', solved ? 'ghost' : 'primary', () => restartDaily()), button('Home', 'ghost', () => close()));
      buzz(solved ? 'celebrate' : 'warn');
      dialog('daily', title, [note], actions);
      return true;
    }
    let recorded = 0;
    function recordResult(m) {
      if (mode !== 'solo' || recorded === m.revision + m.seed) return;
      recorded = m.revision + m.seed;
      if (m.scores[0] > m.scores[1]) { const v = store.read(); v.wins = Object.assign({}, v.wins); v.wins[level] = (v.wins[level] || 0) + 1; store.write(v); if (typeof opts.onReward === 'function') try { opts.onReward('lanterns-win'); } catch (_) {} }
    }
    function statusText(m) {
      if (mode === 'online' && roomStatus) {
        if (roomStatus.connection) return roomStatus.connection;
        if (!roomStatus.seats[1]) return 'Waiting for a rival to sit down…';
      }
      if (m.phase === 'round') return m.result.seat ? pilot(m.result.seat).name + (pilot(m.result.seat).name === 'You' ? ' light' : ' lights') + ' a line!' : 'A long night. Nobody lit a line.';
      if (m.phase === 'over') return pilot(m.scores[0] > m.scores[1] ? 1 : 2).name + (pilot(m.scores[0] > m.scores[1] ? 1 : 2).name === 'You' ? ' win the chart!' : ' wins the chart!');
      const seat = game.turn(m.state), who = pilot(seat);
      if (mode === 'daily') { const left = dailyMovesLeft(m); return seat === 1 ? 'Your move · ' + left + (left === 1 ? ' move' : ' moves') + ' left' : 'Flare defends…'; }
      if (mode === 'solo') return seat === 1 ? 'Your turn · light a star' : 'Flare is choosing a star…';
      if (mode === 'online') return roomStatus && roomStatus.mySeat === seat ? 'Your turn · light a star' : roomStatus && !roomStatus.mySeat ? who.name + ' to light' : who.name + ' is choosing a star…';
      return who.name + ' · your turn';
    }
    function renderStatus() {
      const m = current();
      if (!m) { statusEl.textContent = mode === 'online' ? 'Connecting to the table…' : ''; hintEl.textContent = ''; roundEl.textContent = ''; return; }
      statusEl.textContent = statusText(m);
      roundEl.textContent = mode === 'daily' ? (daily.practice ? 'Daily chart · practice' : 'Daily chart · try ' + Math.min(SpaceDaily().CHART_TRIES, daily.live ? daily.tries : daily.tries + 1) + ' of ' + SpaceDaily().CHART_TRIES) : 'Round ' + m.round + ' · first to ' + m.target;
      const seat = game.turn(m.state), fade = m.phase === 'playing' ? game.fading(m.state, seat) : -1;
      hintEl.textContent = m.phase !== 'playing' ? '' : mode === 'daily' && m.state.ply === daily.state.ply ? 'Light a line in ' + daily.par + '. Flare blocks every threat.' : fade >= 0 && canAct(seat) ? 'Your ' + SPOT[fade] + ' star fades when you light the next one.' : m.state.ply < 2 && canAct(seat) ? 'Tap a star · keys 1-9 or arrows · A on a controller' : '';
      announce(statusText(m) + (hintEl.textContent && fade >= 0 ? '. ' + hintEl.textContent : ''));
    }
    function syncCells() {
      const m = current(), c = m ? game.cells(m.state) : new Array(9).fill(0), seat = m ? game.turn(m.state) : 1;
      const fades = m ? [game.fading(m.state, 1), game.fading(m.state, 2)] : [-1, -1], act = !!m && canAct(seat);
      cells.forEach((b, i) => {
        const owner = c[i] ? pilot(c[i]) : null;
        b.setAttribute('aria-label', SPOT[i] + ' star' + (owner ? ', ' + (owner.name === 'You' ? 'your' : owner.name + '’s') + ' ' + SEATS[c[i]].word + ' star' + (fades[c[i] - 1] === i ? ', fades next' : '') : ', dark'));
        b.setAttribute('aria-disabled', String(!act || !!c[i]));
        b.tabIndex = i === cursor ? 0 : -1;
      });
    }

    /* ---- Dialogs ---- */
    function hideDialog() { dialogWrap.hidden = true; dialogWrap.dataset.kind = ''; }
    function dialog(kind, title, body, actions) {
      dialogEl.replaceChildren();
      const h = el('h2', '', title); h.id = 'ttDialogTitle'; dialogEl.setAttribute('aria-labelledby', h.id);
      dialogEl.append(h);
      for (const node of body) dialogEl.append(node);
      for (const a of actions) dialogEl.append(a);
      dialogWrap.dataset.kind = kind; dialogWrap.hidden = false;
      try { actions[0].focus({ preventScroll: true }); } catch (_) {}
    }
    function showOver(m) {
      if (dialogWrap.dataset.kind === 'over') { const r = dialogEl.querySelector('[data-ready]'); if (r) r.textContent = readyText(m); return; }
      const winner = m.scores[0] > m.scores[1] ? 1 : 2, w = pilot(winner);
      const score = el('div', 'tt-score');
      for (const [text, color] of [[String(m.scores[0]), SEATS[1].color], [' – ', '#FFF6E6'], [String(m.scores[1]), SEATS[2].color]]) { const span = el('span', '', text); span.style.color = color; score.append(span); } score.setAttribute('aria-label', pilot(1).name + ' ' + m.scores[0] + ', ' + pilot(2).name + ' ' + m.scores[1]);
      const mine = mode === 'online' ? roomStatus && roomStatus.mySeat === winner : winner === 1;
      const note = el('p', '', mode === 'solo' ? (winner === 1 ? 'Flare tips her helmet. Try a sharper Flare?' : 'Flare reads the chart well. Watch which star fades next.')
        : mode === 'pass' ? 'Swap seats and go again.' : roomStatus && !roomStatus.mySeat ? 'What a chart. The pilots decide on a rematch.' : mine ? 'Nicely lit.' : 'So close. One more?');
      const ready = el('p', 'tt-note', readyText(m)); ready.dataset.ready = '1';
      const actions = mode === 'online'
        ? [button(roomStatus && roomStatus.mySeat ? 'Rematch' : 'Keep watching', 'primary', () => { if (roomStatus && roomStatus.mySeat) room.rematch(); else hideDialog(); }), button('Leave table', 'ghost', () => { room.close(); view = 'lobby'; mode = null; showView(); })]
        : [button('Rematch', 'primary', () => { hideDialog(); match = kit.next(game, match); shown = null; sync(); }), button(mode === 'solo' ? 'Change rival' : 'Back to the chart room', 'ghost', () => { hideDialog(); view = 'lobby'; mode = null; match = null; showView(); }), button('Home', 'ghost', () => close())];
      const art = el('canvas'); art.width = 240; art.height = 200; art.style.cssText = 'width:120px;height:100px;margin:0 auto'; art.setAttribute('aria-hidden', 'true');
      if (root.SpaceManArt && root.SpaceManArt.drawAvatar) { const g = art.getContext('2d'); g.scale(2, 2); g.globalAlpha = .45; g.drawImage(glowSprite(SEATS[winner].glow), 15, 5, 90, 90); g.globalAlpha = 1; root.SpaceManArt.drawAvatar(g, 60, 26, 80, w.appearance || FRIEND, { reduceMotion: true, mood: 1 }); }
      dialog('over', w.name === 'You' ? 'You win the chart!' : w.name + ' wins the chart!', mode === 'online' ? [art, score, note, ready] : [art, score, note], actions);
    }
    function readyText(m) {
      if (mode !== 'online' || !roomStatus) return '';
      const r = roomStatus.ready, me = roomStatus.mySeat;
      if (!me) return 'The pilots decide on a rematch.';
      return r & (1 << (me - 1)) ? (r === 3 ? 'Starting…' : 'Ready. Waiting for ' + pilot(3 - me).name + '…') : r ? pilot(3 - me).name + ' wants a rematch.' : '';
    }
    function openMenu() {
      const rules = el('p', '', 'Light any dark star. You keep three lit; lighting a fourth lets your oldest fade (it flickers first). Three of yours in a straight line makes a constellation and wins the round. First to two rounds takes the chart.');
      const actions = [button('Resume', 'primary', () => { hideDialog(); try { cells[cursor].focus({ preventScroll: true }); } catch (_) {} })];
      if (mode === 'online') actions.push(button('Leave table', 'ghost', () => { hideDialog(); room.close(); view = 'lobby'; mode = null; showView(); }));
      else if (mode === 'daily') { if (daily.practice) actions.push(button('Restart chart', 'ghost', () => { hideDialog(); restartDaily(); })); }
      else actions.push(button('Restart match', 'ghost', () => { hideDialog(); startLocal(mode); }), button('Back to the chart room', 'ghost', () => { clearTimers(); hideDialog(); view = 'lobby'; mode = null; match = null; showView(); }));
      actions.push(button('Home', 'ghost', () => close()));
      dialog('menu', 'Constellations', [rules], actions);
    }

    /* ---- Input: keys and gamepad move the same focus ring the board buttons use. ---- */
    function moveCursor(dx, dy) {
      const c = clamp(cursor % 3 + dx, 0, 2), r = clamp(Math.floor(cursor / 3) + dy, 0, 2);
      if (r * 3 + c === cursor) return;
      cursor = r * 3 + c; syncCells(); sfx.move();
      try { cells[cursor].focus({ preventScroll: true }); } catch (_) {}
    }
    function onKey(e) {
      if (!active) return;
      keyNav = true;
      if (e.key === 'Escape') { e.preventDefault(); if (!dialogWrap.hidden && dialogWrap.dataset.kind === 'menu') hideDialog(); else if (view === 'match' && dialogWrap.hidden) openMenu(); else if (view === 'lobby') close(); return; }
      if (view !== 'match' || !dialogWrap.hidden) return;
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
      if (dirs[e.code]) { e.preventDefault(); moveCursor(...dirs[e.code]); return; }
      const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (n) { e.preventDefault(); cursor = +n[2] - 1; syncCells(); choose(cursor); }
    }
    function pollPad(t) {
      const pads = root.navigator.getGamepads ? Array.from(root.navigator.getGamepads() || []).filter(Boolean) : [];
      const p = pads[0]; if (!p) return;
      const btn = i => !!(p.buttons[i] && p.buttons[i].pressed), ax = p.axes || [];
      const state = { a: btn(0), b: btn(1), start: btn(9), l: btn(14) || ax[0] < -.5, r: btn(15) || ax[0] > .5, u: btn(12) || ax[1] < -.5, d: btn(13) || ax[1] > .5 };
      const edge = k => state[k] && !padPrev[k], dir = state.l || state.r || state.u || state.d;
      if (dir || state.a || state.b || state.start) keyNav = true;
      if (dir && (edge('l') || edge('r') || edge('u') || edge('d') || t > padRepeat)) {
        if (view === 'match' && dialogWrap.hidden) moveCursor(state.l ? -1 : state.r ? 1 : 0, state.u ? -1 : state.d ? 1 : 0);
        else { const f = Array.from(rootEl.querySelectorAll(view === 'match' ? '.tt-dialog button' : '.tt-lobby button:not([disabled])')).filter(b => b.offsetParent); const i = f.indexOf(document.activeElement); const nx = f[clamp(i + (state.l || state.u ? -1 : 1), 0, f.length - 1)]; if (nx) nx.focus(); }
        padRepeat = t + (edge('l') || edge('r') || edge('u') || edge('d') ? 380 : 160);
      }
      if (edge('a')) { if (view === 'match' && dialogWrap.hidden) choose(cursor); else if (document.activeElement && rootEl.contains(document.activeElement)) document.activeElement.click(); }
      if (edge('b')) { if (!dialogWrap.hidden && dialogWrap.dataset.kind === 'menu') hideDialog(); else if (view === 'lobby') close(); else if (dialogWrap.hidden) openMenu(); }
      if (edge('start') && view === 'match') { if (dialogWrap.hidden) openMenu(); else if (dialogWrap.dataset.kind === 'menu') hideDialog(); }
      padPrev = state;
    }

    /* ---- Rendering ---- */
    function frame(ts) {
      raf = 0; if (!active) return;
      const t = now();
      pollPad(t);
      draw(t);
      // A still lobby needs no frames; the board animates while a match is on screen.
      if (view === 'match' || !calm()) raf = root.requestAnimationFrame(frame);
      else raf = 0;
    }
    function drawPilot(c, seat, x, y, size, t, m) {
      const p = pilot(seat), turn = m && m.phase === 'playing' && game.turn(m.state) === seat, still = calm(), s = SEATS[seat];
      c.save();
      if (turn) { c.globalAlpha = .5 + (still ? .2 : .2 * Math.sin(t / 260)); c.drawImage(glowSprite(s.glow), x - size * .9, y - size * .25, size * 1.8, size * 1.8); c.globalAlpha = 1; }
      if (root.SpaceManArt && root.SpaceManArt.drawAvatar && !p.empty) {
        const look = m && m.phase === 'playing' && !turn ? 0 : (layout.wide ? (seat === 1 ? 1 : -1) : (seat === 1 ? .6 : -.6));
        root.SpaceManArt.drawAvatar(c, x, y, size, p.appearance || FRIEND, { time: t / 1000 + seat * 1.7, reduceMotion: still, lookX: look, lookY: .4,
          mood: m && m.phase !== 'playing' && m.result && m.result.seat ? (m.result.seat === seat ? 1 : 3) : null });
      } else { c.globalAlpha = .4; c.strokeStyle = '#D9D0FF'; c.setLineDash([5, 5]); c.beginPath(); c.arc(x, y + size * .45, size * .32, 0, TAU); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
      // Name plate and round pips sit under the pilot.
      const py = y + size * 1.02, label = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
      c.font = '800 13px ' + body();
      const tw = Math.max(70, c.measureText(label).width + 40);
      c.fillStyle = turn ? '#2E2A52' : '#0E1026cc'; roundedRect(c, x - tw / 2, py, tw, 26, 13); c.fill();
      c.strokeStyle = turn ? s.color : '#B4A6E833'; c.lineWidth = 1.5; c.stroke();
      star(c, x - tw / 2 + 14, py + 13, 6, seat);
      c.fillStyle = '#FFF6E6'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x + 6, py + 13.5);
      if (m) for (let k = 0; k < m.target; k++) {
        const px = x + (k - (m.target - 1) / 2) * 20, won = m.scores[seat - 1] > k;
        c.fillStyle = won ? s.color : '#ffffff26'; c.beginPath(); c.arc(px, py + 40, 7, 0, TAU); c.fill();
      }
      c.restore();
    }
    function cellXY(i) { return [layout.bx + (i % 3 + .5) * layout.step, layout.by + (Math.floor(i / 3) + .5) * layout.step]; }
    function draw(t) {
      const c = ctx; if (!c || !layout) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (sky) c.drawImage(sky, 0, 0, width, height); else { c.fillStyle = REGION.skyTop; c.fillRect(0, 0, width, height); }
      if (view !== 'match') return;
      const m = current(), still = calm();
      let sx = 0, sy = 0;
      if (anim.shake > 0) { sx = (Math.sin(t * .09) * 6) * anim.shake; sy = (Math.cos(t * .11) * 5) * anim.shake; anim.shake = Math.max(0, anim.shake - .02); }
      c.save(); c.translate(sx, sy);
      const { bx, by, side, step } = layout;
      // The chart: a soft plate, then the constellation threads between neighbouring stars.
      c.fillStyle = '#0B0D22b0'; roundedRect(c, bx - 10, by - 10, side + 20, side + 20, 28); c.fill();
      c.strokeStyle = '#B4A6E829'; c.lineWidth = 1.5; c.stroke();
      c.strokeStyle = '#B4A6E833'; c.lineWidth = 1.2;
      c.beginPath();
      for (let i = 0; i < 9; i++) { const [x, y] = cellXY(i); if (i % 3 < 2) { const [x2, y2] = cellXY(i + 1); c.moveTo(x, y); c.lineTo(x2, y2); } if (i < 6) { const [x2, y2] = cellXY(i + 3); c.moveTo(x, y); c.lineTo(x2, y2); } }
      c.stroke();
      const owners = m ? game.cells(m.state) : new Array(9).fill(0), turn = m ? game.turn(m.state) : 1, act = !!m && canAct(turn);
      const fades = m && m.phase === 'playing' ? [game.fading(m.state, 1), game.fading(m.state, 2)] : [-1, -1];
      const r = step * .27;
      for (let i = 0; i < 9; i++) {
        const [x, y] = cellXY(i);
        socket(c, x, y, r * 1.4, t / 1000, still, act && !owners[i] && (i === hover || (keyNav && i === cursor)));
        if (!owners[i] && act && (i === hover || (keyNav && i === cursor && document.activeElement === cells[i]))) star(c, x, y, r, turn, { alpha: .32, lit: .6 });
      }
      // Stars fading: they sink, shrink and shed a few sparks.
      anim.gone = anim.gone.filter(g => t - g.t < 650);  // g.t may be in the future for a staggered sweep
      for (const g of anim.gone) {
        const k = Math.max(0, (t - g.t) / 650), [x, y] = cellXY(g.i);
        star(c, x, y + k * r * .6, r * (1 - k * .5), g.seat, { alpha: 1 - k, lit: 1 - k });
        if (!still) { c.fillStyle = SEATS[g.seat].glow; for (let e = 0; e < 4; e++) { c.globalAlpha = (1 - k) * .8; c.fillRect(x + (e - 1.5) * r * .4, y + r * (.4 + k * (1.2 + e * .3)), 2, 2); } c.globalAlpha = 1; }
      }
      for (let i = 0; i < 9; i++) {
        if (!owners[i]) continue;
        const [x, y] = cellXY(i), born = anim.placed.get(i), k = born ? (t - born) / 360 : 1, fading = fades[owners[i] - 1] === i;
        const scale = still ? 1 : born && k < 1 ? back(k) : 1, flick = fading ? (still ? .5 : .5 + .5 * Math.sin(t / 90 + i)) : 0;
        const bob = still ? 0 : Math.sin(t / 900 + i * 1.3) * r * .05;
        star(c, x, y + bob, r * scale, owners[i], { lit: fading ? .5 : 1, flicker: flick });
        if (fading) {
          // Goes dark next: a dashed ring that the eye can find without colour.
          c.save(); c.strokeStyle = SEATS[owners[i]].light; c.globalAlpha = .9; c.lineWidth = 2.5; c.setLineDash([5, 5]);
          c.lineDashOffset = still ? 0 : -t / 40; c.beginPath(); c.arc(x, y, r * 1.45, 0, TAU); c.stroke(); c.restore();
        }
      }
      // A won line: a beam of light runs through the three stars.
      if (m && m.result && m.result.seat && m.result.line.length) {
        const k = still ? 1 : easeOut((t - (anim.winAt || t - 1000)) / 420), line = m.result.line, [x1, y1] = cellXY(line[0]), [x2, y2] = cellXY(line[line.length - 1]);
        c.save(); c.lineCap = 'round';
        c.strokeStyle = SEATS[m.result.seat].glow; c.globalAlpha = .35; c.lineWidth = r * .9; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k); c.stroke();
        c.strokeStyle = '#FFFFFF'; c.globalAlpha = .9; c.lineWidth = 3; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k); c.stroke();
        c.restore();
      }
      // Shared FX kit for the sparkle on a new star and the star on a win.
      if (root.SpaceManFX && !still) {
        anim.fx = anim.fx.filter(f => t - f.t < (root.SpaceManFX.LIFE[f.kind] || 30) * 16.7);
        for (const f of anim.fx) { const [x, y] = cellXY(f.i); root.SpaceManFX.draw(c, f.kind, x, y, (t - f.t) / ((root.SpaceManFX.LIFE[f.kind] || 30) * 16.7), { scale: step / 120, color: SEATS[f.seat].color, seed: f.i + 1 }); }
      }
      // Between rounds: a plate across the chart says who took the round and the score.
      if (m && m.phase === 'round') {
        const k = still ? 1 : easeOut((t - (anim.winAt || t - 1000) - 450) / 300);
        if (k > 0) {
          const w = Math.min(side * .9, 420), h = 76, x0 = bx + (side - w) / 2, y0 = by + side / 2 - h / 2 + (1 - k) * 12, seat = m.result.seat;
          c.save(); c.globalAlpha = k;
          c.fillStyle = '#16142Ef2'; roundedRect(c, x0, y0, w, h, 20); c.fill();
          c.strokeStyle = seat ? SEATS[seat].color : '#B4A6E8'; c.lineWidth = 2; c.stroke();
          c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#FFF6E6'; c.font = '800 19px ' + display();
          const who = seat ? pilot(seat).name : '';
          c.fillText(seat ? 'Round ' + m.round + (who === 'You' ? ' is yours' : ' to ' + who) : 'Round ' + m.round + ' · a long night', x0 + w / 2, y0 + 28);
          c.font = '700 15px ' + body(); c.fillStyle = '#C9C6E8';
          c.fillText(m.scores[0] + ' – ' + m.scores[1] + ' · next round soon', x0 + w / 2, y0 + 54);
          c.restore();
        }
      }
      // Cursor ring for keyboard and controller play.
      if (m && keyNav && document.activeElement === cells[cursor]) {
        // Full strength on a star you can light; faint on one you cannot, so it never promises a move that does not exist.
        const [x, y] = cellXY(cursor); c.save(); c.strokeStyle = '#FFE59A'; c.lineWidth = 3; c.globalAlpha = act && !owners[cursor] ? .9 : .3; roundedRect(c, x - step * .44, y - step * .44, step * .88, step * .88, step * .22); c.stroke(); c.restore();
      }
      c.restore();
      const size = layout.wide ? clamp(layout.bx * .5, 70, 130) : clamp(layout.pilots * .62, 56, 92);
      drawPilot(c, 1, layout.seatX[1], layout.seatY, size, t, m);
      drawPilot(c, 2, layout.seatX[2], layout.seatY, size, t, m);
      if (!layout.wide) { c.save(); c.fillStyle = '#B4A6E8'; c.font = '800 13px ' + display(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('VS', width / 2, layout.seatY + size * .55); c.restore(); }
    }
    // Lobby art: you and Flare across a little chart, plus the three rule diagrams. Drawn once per open.
    function drawLobbyArt() {
      const c = heroCanvas.getContext('2d'), W = 520, H = 220; c.setTransform(2, 0, 0, 2, 0, 0);
      c.drawImage(starfield(W, H, 3), 0, 0, W, H);
      const side = 132, bx = W / 2 - side / 2, by = 48, step = side / 3;
      c.fillStyle = '#0B0D22c0'; roundedRect(c, bx - 8, by - 8, side + 16, side + 16, 18); c.fill();
      const demo = [1, 2, 0, 0, 1, 2, 2, 0, 1];
      for (let i = 0; i < 9; i++) { const x = bx + (i % 3 + .5) * step, y = by + (Math.floor(i / 3) + .5) * step; socket(c, x, y, step * .36, 0, true, false); if (demo[i]) star(c, x, y, step * .24, demo[i], { lit: i === 1 ? .7 : 1 }); }
      c.save(); c.strokeStyle = '#FFFFFF'; c.globalAlpha = .85; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(bx + step * .5, by + step * .5); c.lineTo(bx + step * 2.5, by + step * 2.5); c.stroke(); c.restore();
      if (root.SpaceManArt && root.SpaceManArt.drawAvatar) {
        root.SpaceManArt.drawAvatar(c, 96, 62, 104, typeof opts.appearance === 'function' ? opts.appearance() : null, { reduceMotion: true, lookX: 1, lookY: .3, mood: 1 });
        root.SpaceManArt.drawAvatar(c, W - 96, 62, 104, RIVAL.appearance, { reduceMotion: true, lookX: -1, lookY: .3 });
      }
      c.font = '800 14px ' + display(); c.textAlign = 'center'; c.fillStyle = '#FFF6E6'; c.fillText('YOU', 96, 186); c.fillText('FLARE', W - 96, 186);
      for (const rc of rootEl.querySelectorAll('.tt-rules canvas')) {
        const g = rc.getContext('2d'), k = +rc.dataset.rule; g.clearRect(0, 0, 128, 128);
        const at = i => [24 + (i % 3) * 40, 24 + Math.floor(i / 3) * 40];
        for (let i = 0; i < 9; i++) { const [x, y] = at(i); socket(g, x, y, 14, 0, true, false); }
        const boards = [[0, 0, 0, 0, 1, 0, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, 1, 0, 0]];
        boards[k].forEach((s, i) => { if (s) { const [x, y] = at(i); star(g, x, y, 10, 1, { lit: k === 1 && i === 0 ? .6 : 1, flicker: k === 1 && i === 0 ? .6 : 0 }); } });
        if (k === 1) { const [x, y] = at(0); g.strokeStyle = SEATS[1].light; g.setLineDash([3, 4]); g.lineWidth = 2; g.beginPath(); g.arc(x, y, 17, 0, TAU); g.stroke(); g.setLineDash([]); }
        if (k === 2) { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round'; const [x1, y1] = at(2), [x2, y2] = at(6); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
        if (k === 0) { g.strokeStyle = '#FFE59A'; g.lineWidth = 2; const [x, y] = at(4); roundedRect(g, x - 18, y - 18, 36, 36, 9); g.stroke(); }
      }
    }

    return Object.freeze({
      open, close, hostRoom, joinInvite, daily: startDaily,
      get active() { return active; },
      get screen() { return !active ? 'closed' : view === 'lobby' ? 'lobby' : !dialogWrap.hidden ? dialogWrap.dataset.kind : 'match'; },
      // Test and automation seam: the visible match, pilots and mode.
      debug: () => ({ mode, level, daily, match: current(), pilots: [pilot(1), pilot(2)], status: statusEl ? statusEl.textContent : '', room: room ? room.status() : null }),
    });
  }
  root.SpaceManTableUI = Object.freeze({ create, seats: SEATS });
})(typeof window !== 'undefined' ? window : globalThis);
