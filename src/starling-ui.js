/* Space Man · Starlings: the befriending call
   A Starling drifts out of the Bloom garden rafts and sings a short call of
   light on four points around it. Echo it in time and it chooses to ride in
   your helmet light. Rules live in src/starling.js; this file is presentation
   only. Lazy: no DOM, listeners, frames, storage or audio before open().

   The scene is one canvas with four real buttons laid over the answer points,
   so touch, pointer, keys (arrows or WASD), the gamepad (d-pad or face
   buttons, same layout) and screen readers all answer the same way. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const REGION = Object.freeze({ skyTop: '#061817', horizon: '#173C36', accent: '#4EF07A', grass: '#1F9E4E', soil: '#0B2A26', you: '#38E1FF', gold: '#FFE59A' });
  // Each point keeps a note, low to high from down to up, so the call can be heard as well as seen.
  const NOTES = Object.freeze({ down: 440, left: 523.25, right: 659.25, up: 783.99 });
  const DIRS = Object.freeze({ left: [-1, 0], up: [0, -1], right: [1, 0], down: [0, 1] });
  const LEAD = 650;         // ms between a call starting and its first pulse
  const LISTEN = 6500;      // a Starling sings again (no penalty) if nobody echoes
  const REACT = 1000, LEAVE = 1500;

  const STYLES = `
.sl-root{position:fixed;inset:0;z-index:1000;isolation:isolate;overflow:hidden;background:linear-gradient(180deg,${REGION.skyTop},${REGION.horizon});color:#E6FFF2;font-family:var(--sm-font-body,ui-rounded,system-ui,sans-serif);font-size:14px;line-height:1.4;-webkit-user-select:none;user-select:none;color-scheme:dark;touch-action:manipulation;
  --sl-top:env(safe-area-inset-top,0px);--sl-right:env(safe-area-inset-right,0px);--sl-bottom:env(safe-area-inset-bottom,0px);--sl-left:env(safe-area-inset-left,0px)}
.sl-root[hidden],.sl-root [hidden]{display:none!important}
.sl-root *,.sl-root *:before,.sl-root *:after{box-sizing:border-box}
.sl-root :focus-visible{outline:3px solid #FFE59A;outline-offset:2px}
.sl-root button{-webkit-tap-highlight-color:transparent;font-family:inherit}
.sl-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.sl-hud{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:calc(8px + var(--sl-top)) calc(12px + var(--sl-right)) 0 calc(12px + var(--sl-left));pointer-events:none}
.sl-hud>*{pointer-events:auto}
.sl-back{min-width:48px;min-height:48px;padding:0 14px;border-radius:14px;border:1px solid #4EF07A33;background:#06181799;color:#E6FFF2;font-size:14px;font-weight:750;cursor:pointer}
.sl-friends{min-height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;border-radius:18px;background:#06181799;box-shadow:inset 0 0 0 1px #4EF07A33;font-size:13px;font-weight:750;color:#CFFFE0}
.sl-cue{position:absolute;left:16px;right:16px;text-align:center;font-family:var(--sm-font-display,inherit);font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#CFFFE0;text-shadow:0 2px 10px #000a;pointer-events:none;transition:opacity .25s}
.sl-point{position:absolute;margin:0;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;touch-action:manipulation}
.sl-point:focus-visible{outline:3px solid #FFE59A;outline-offset:-6px}
.sl-dialog-wrap{position:absolute;inset:0;z-index:10;display:grid;place-items:center;padding:calc(16px + var(--sl-top)) 16px calc(16px + var(--sl-bottom));background:#020a0999}
.sl-dialog{width:min(420px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:20px;border-radius:22px;background:linear-gradient(180deg,#123A33,#0A1F1C);box-shadow:inset 0 0 0 1px #4EF07A40,0 20px 50px #000a;text-align:center}
.sl-dialog h2{margin:0;font-family:var(--sm-font-display,inherit);font-size:24px;line-height:1.15;color:#FFF8E0}
.sl-dialog p{margin:0;color:#CFE9DD}
.sl-dialog canvas{align-self:center;width:120px;height:96px}
.sl-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0;padding:12px 18px;border:1px solid #4EF07A44;border-radius:14px;background:#14352F;color:#E6FFF2;font-size:15px;font-weight:750;cursor:pointer;box-shadow:inset 0 1px 0 #ffffff14,0 6px 16px #0005}
.sl-btn.primary{background:linear-gradient(180deg,#7DF5A0,#4EF07A);border-color:#B8FFD0;color:#062012}
.sl-btn:active{transform:translateY(1px) scale(.98)}
@media (hover:hover){.sl-btn:hover{border-color:#CFFFE0}}
.sl-diary{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:0;padding:0;list-style:none}
.sl-diary li{display:flex;align-items:center;gap:5px;padding:3px 9px 3px 4px;border-radius:12px;background:#06181799;font-size:12px;color:#CFE9DD}
.sl-diary i{display:block;width:12px;height:12px;border-radius:50%;box-shadow:0 0 8px currentColor;background:currentColor}
.sl-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(text, cls, fn) { const n = el('button', 'sl-btn ' + (cls || ''), text); n.type = 'button'; if (fn) n.addEventListener('click', fn); return n; }

  /* ---- Painters. Glows are cached sprites; nothing allocates a gradient per frame. ---- */
  const sprites = new Map();
  function glow(color) {
    if (sprites.has(color)) return sprites.get(color);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, color); grad.addColorStop(.35, color + '66'); grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128); sprites.set(color, c); return c;
  }
  function sprite(c, color, x, y, r, a) { c.globalAlpha = a; c.drawImage(glow(color), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; }
  // A leaf of light: a pointed oval along +x from the origin.
  function leaf(c, len, wide) {
    c.beginPath(); c.moveTo(0, 0);
    c.quadraticCurveTo(len * .45, -wide, len, 0); c.quadraticCurveTo(len * .45, wide, 0, 0); c.closePath();
  }
  /**
   * A Starling: a soft round core of light, two leaf petals that fold when shy
   * and fan when trusting, and two eye-sparks. No face beyond the eyes.
   * open: 0 folded … 1 fanned. glowBoost brightens a pulse. look: [-1..1, -1..1]. trust: bright motes, 0-3.
   */
  function drawStarling(c, x, y, r, hue, { open = .5, glowBoost = 0, t = 0, blink = 0, look = [0, 0], alpha = 1, trust = 3 } = {}) {
    c.save(); c.globalAlpha = alpha;
    sprite(c, hue.core, x, y, r * (3 + glowBoost * 1.4), alpha * (.45 + glowBoost * .4));
    // Petals hinge at the core's sides, behind it: folded they droop and cup the core, fanned they
    // open out level like leaves in sun. They never point up, so a Starling never reads as horns.
    for (const side of [-1, 1]) {
      const lift = -1 + clamp(open, 0, 1) * 1.35, len = r * (1.35 + open * .4);
      c.save(); c.translate(x + side * r * .55, y + r * .1);
      c.rotate(side > 0 ? -lift : Math.PI + lift);
      c.globalAlpha = alpha * .92; c.fillStyle = hue.petal; leaf(c, len, r * .5); c.fill();
      c.globalAlpha = alpha * .55; c.fillStyle = hue.core; leaf(c, len * .82, r * .26); c.fill();
      c.globalAlpha = alpha * .9; c.strokeStyle = hue.core; c.lineWidth = Math.max(1, r * .06);
      c.beginPath(); c.moveTo(r * .05, 0); c.lineTo(len * .9, 0); c.stroke();
      c.restore();
    }
    // Three motes of its own light circle it, slow and close: one brightens for each clean echo, so they show its trust.
    if (r > 8) for (let i = 0; i < 3; i++) {
      const a = t / 900 + i * TAU / 3, lit = i < trust, mx = x + Math.cos(a) * r * 1.6, my = y + Math.sin(a) * r * .6 + r * .15;
      if (lit) sprite(c, hue.core, mx, my, r * .45, alpha * .8);
      c.globalAlpha = alpha * (lit ? 1 : .35); c.fillStyle = lit ? '#FFFFFF' : hue.core;
      c.beginPath(); c.arc(mx, my, Math.max(1.2, r * (lit ? .13 : .06)), 0, TAU); c.fill();
    }
    c.globalAlpha = alpha;
    c.fillStyle = hue.core; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.globalAlpha = alpha * .7; c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x - r * .3, y - r * .35, r * .32, 0, TAU); c.fill();
    // Eye-sparks: two small bright marks, squashed on a blink.
    c.globalAlpha = alpha; c.fillStyle = '#062012';
    const ex = look[0] * r * .14, ey = look[1] * r * .1 + r * .05, h = r * .2 * (1 - clamp(blink, 0, 1) * .85);
    for (const side of [-1, 1]) { c.beginPath(); c.ellipse(x + side * r * .3 + ex, y + ey, r * .1, h, 0, 0, TAU); c.fill(); }
    if (blink < .5) { c.fillStyle = '#FFFFFF'; for (const side of [-1, 1]) c.fillRect(x + side * r * .3 + ex - r * .06, y + ey - h * .6, Math.max(1, r * .05), Math.max(1, r * .05)); }
    c.restore();
  }

  function create(options) {
    const opts = options || {}, rules = root.SpaceManStarling;
    let rootEl = null, canvas = null, ctx = null, cueEl = null, friendsEl = null, live = null, dialogWrap = null, dialogEl = null, points = {};
    let inertSiblings = [], active = false, raf = 0, width = 0, height = 0, dpr = 1, sky = null, layout = null, audio = null, lastAnnounced = '';
    // phase: intro | call | listen | answer | react | leaving | result | menu
    let phase = 'intro', phaseAt = 0, state = null, who = null, hue = null, beats = [], expect = [], grades = [], answerAt = 0, callAt = 0, sung = 0;
    let fx = [], pads = { left: 0, up: 0, right: 0, down: 0 }, padHit = {}, fly = null, codex = [], lastClean = false, padPrev = {};
    const listeners = [];
    const now = () => root.performance.now();
    const prefs = () => (typeof opts.settings === 'function' ? opts.settings() : {}) || {};
    const calm = () => !!(prefs().reduceMotion || prefs().batterySaver || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || (document.body && document.body.classList.contains('reduce-motion')));
    const buzz = kind => { if (typeof opts.buzz === 'function') try { opts.buzz(kind); } catch (_) {} };
    const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push(() => target.removeEventListener(type, fn, o)); };
    const key = opts.storageKey || 'sm2.starlings.v1';
    const store = {
      read() { try { return JSON.parse(root.localStorage.getItem(key)) || {}; } catch (_) { return {}; } },
      write(v) { try { root.localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} },
    };
    const newSeed = () => { try { return root.crypto.getRandomValues(new Uint32Array(1))[0]; } catch (_) { return (Math.random() * 0x100000000) >>> 0; } };

    /* ---- Audio: the Starling sings in sine, you answer in triangle. Quiet and optional. ---- */
    function ctxAudio() {
      const p = prefs();
      if (p.muted || p.sfx === false) return null;
      try {
        if (!audio) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return null; audio = new A(); }
        if (audio.state === 'suspended') audio.resume().catch(() => {});
        return audio;
      } catch (_) { return null; }
    }
    function note(freq, { at = 0, type = 'sine', dur = .28, vol = .12, slide = 1.02 } = {}) {
      const a = ctxAudio(); if (!a) return;
      try {
        const p = prefs(), t = a.currentTime + .01 + Math.max(0, at) / 1000, level = clamp(p.sfxVol === undefined ? .7 : p.sfxVol, 0, 1) * vol;
        for (const [mult, v] of [[1, 1], [2, .25]]) {
          const o = a.createOscillator(), g = a.createGain();
          o.type = type; o.frequency.setValueAtTime(freq * mult, t); o.frequency.exponentialRampToValueAtTime(freq * mult * slide, t + dur);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * v, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
          o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + .02);
        }
      } catch (_) {}
    }
    const chord = (freqs, gap, o) => freqs.forEach((f, i) => note(f, Object.assign({ at: i * gap }, o)));
    function announce(text) { if (live && text && text !== lastAnnounced) { lastAnnounced = text; live.textContent = text; } }

    /* ---- DOM ---- */
    function build() {
      if (!document.getElementById('sl-style')) { const s = el('style'); s.id = 'sl-style'; s.textContent = STYLES; document.head.appendChild(s); }
      rootEl = el('div', 'sl-root'); rootEl.hidden = true; rootEl.setAttribute('role', 'application'); rootEl.setAttribute('aria-label', 'Starlings');
      canvas = el('canvas', 'sl-canvas'); canvas.setAttribute('aria-hidden', 'true'); ctx = canvas.getContext('2d');
      live = el('div', 'sl-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      const hud = el('div', 'sl-hud'), back = el('button', 'sl-back', '‹ Home'); back.type = 'button'; back.id = 'slBack'; back.addEventListener('click', () => close());
      friendsEl = el('div', 'sl-friends'); friendsEl.setAttribute('role', 'note');
      hud.append(back, friendsEl);
      cueEl = el('div', 'sl-cue'); cueEl.setAttribute('aria-hidden', 'true');
      for (const p of rules.POINTS) {
        const b = el('button', 'sl-point'); b.type = 'button'; b.dataset.point = p; b.setAttribute('aria-label', p + ' light');
        b.addEventListener('pointerdown', e => { e.preventDefault(); echo(p); });
        // Keyboard and switch users reach the points with Enter or Space on a focused button.
        b.addEventListener('click', e => { if (e.detail === 0) echo(p); });
        points[p] = b;
      }
      dialogWrap = el('div', 'sl-dialog-wrap'); dialogWrap.hidden = true;
      dialogEl = el('div', 'sl-dialog'); dialogEl.setAttribute('role', 'dialog'); dialogEl.setAttribute('aria-modal', 'true');
      dialogWrap.append(dialogEl);
      rootEl.append(canvas, hud, cueEl, ...Object.values(points), dialogWrap, live);
      document.body.append(rootEl);
    }
    function dialog(kind, title, body, actions) {
      dialogEl.replaceChildren(); dialogWrap.dataset.kind = kind;
      const h = el('h2', '', title); h.id = 'slDialogTitle'; dialogEl.setAttribute('aria-labelledby', h.id);
      dialogEl.append(h, ...body, ...actions); dialogWrap.hidden = false;
      try { actions[0].focus({ preventScroll: true }); } catch (_) {}
    }
    function hideDialog() { dialogWrap.hidden = true; dialogWrap.dataset.kind = ''; }
    function diary() {
      const ul = el('ul', 'sl-diary'); ul.setAttribute('aria-label', 'Starlings in your helmet light');
      for (const e of codex.slice(-12)) { const li = el('li'), dot = el('i'); dot.style.color = rules.hue(e.hue).core; li.append(dot, document.createTextNode(e.name)); ul.append(li); }
      return ul;
    }
    function syncFriends() {
      const n = codex.length;
      friendsEl.textContent = '✦ ' + n;
      friendsEl.setAttribute('aria-label', n === 1 ? 'One Starling rides with you' : n + ' Starlings ride with you');
      friendsEl.hidden = !n;
    }

    /* ---- The encounter ---- */
    function setPhase(p, t = now()) { phase = p; phaseAt = t; rootEl.dataset.phase = p; syncCue(); }
    function syncCue() {
      const first = !codex.length && state && state.verse === 0 && state.take === 0;
      const text = phase === 'call' ? (first ? 'Listen to its lights' : 'Listen')
        : phase === 'listen' || phase === 'answer' ? (first ? 'Your echo: same points, same rhythm' : 'Your echo')
        : phase === 'react' && state && state.phase === 'call' ? (lastClean ? 'Closer' : 'Slower, once more') : '';
      cueEl.textContent = text; cueEl.style.opacity = text ? '1' : '0';
    }
    function encounter() {
      hideDialog();
      const seed = typeof opts.seed === 'function' ? opts.seed() >>> 0 : newSeed();
      state = rules.start(seed, codex.length); who = rules.starling(seed); hue = rules.hue(who.hue);
      fx = []; fly = null; grades = []; sung = 0;
      setPhase('intro');
      announce(codex.length ? 'A Starling drifts close and starts to sing.' : 'A Starling drifts close. It sings lights on four points: left, up, right and down. Listen, then echo them in time with the arrows, the d-pad or by tapping.');
    }
    function sing(t) {
      beats = rules.verse(state); expect = rules.answer(beats); grades = []; callAt = t + LEAD; sung++;
      for (const b of beats) note(NOTES[b.point], { at: LEAD + b.at, dur: .34, vol: .11, slide: 1.03 });
      setPhase('call', t);
      announce('It sings: ' + beats.map(b => b.point).join(', ') + '.');
    }
    function echo(point) {
      if (!active || !dialogWrap.hidden || !DIRS[point]) return;
      const t = now();
      if (phase !== 'listen' && phase !== 'answer') { pads[point] = t; padHit[point] = 'idle'; return; }
      if (phase === 'listen') { answerAt = t; setPhase('answer', t); }
      const i = grades.length, grade = rules.judge(expect[i], t - answerAt, point);
      grades.push(grade);
      pads[point] = t; padHit[point] = grade;
      note(NOTES[point], { type: 'triangle', dur: .22, vol: grade === 'miss' ? .05 : .1, slide: grade === 'miss' ? .94 : 1 });
      buzz(grade === 'miss' ? 'select' : 'tap');
      const [px, py] = padAt(point);
      fx.push({ kind: grade === 'miss' ? 'puff' : 'mote', from: [px, py], to: [layout.cx, layout.cy], at: t, color: grade === 'perfect' ? REGION.gold : REGION.you });
      if (grades.length >= expect.length) finishVerse(t);
    }
    function finishVerse(t) {
      const before = state;
      state = rules.respond(state, grades);
      lastClean = state.trust > before.trust;
      if (lastClean) { chord([NOTES.left, NOTES.right, NOTES.up, NOTES.up * 1.5], 70, { dur: .3, vol: .08 }); buzz('success'); for (let k = 0; k < 10; k++) fx.push({ kind: 'spark', at: t + k * 18, a: k / 10 * TAU, color: k % 2 ? REGION.gold : hue.core }); }
      else note(NOTES.left, { at: 120, dur: .5, vol: .06, slide: .98 });
      announce(state.phase === 'befriended' ? '' : lastClean ? 'It brightens. ' + (rules.TRUST - state.trust) + ' more.' : state.phase === 'shy' ? '' : 'It slows down and sings again.');
      setPhase('react', t);
    }
    function befriend(t) {
      codex = codex.filter(e => e.seed !== who.seed).concat(rules.entry(who.seed, Date.now()));
      const v = store.read(); v.codex = codex; store.write(v); syncFriends();
      chord([NOTES.down, NOTES.left, NOTES.right, NOTES.up, NOTES.up * 1.335, NOTES.up * 2], 110, { dur: .4, vol: .09 });
      if (typeof opts.onBefriend === 'function') try { opts.onBefriend(who, codex.length); } catch (_) {}
      fly = { at: t };
      setPhase('leaving', t);
      announce(who.name + ' chooses to ride in your helmet light.');
    }
    function showResult() {
      setPhase('result');
      const art = el('canvas'); art.width = 240; art.height = 192; art.setAttribute('aria-hidden', 'true');
      const g = art.getContext('2d');
      const friend = state.phase === 'befriended';
      drawStarling(g, 120, 100, 30, hue, { open: friend ? 1 : 0, alpha: friend ? 1 : .6, look: friend ? [0, 0] : [-.6, .4] });
      const again = button(friend ? 'Call another' : 'Listen for another', 'primary', () => encounter()); again.id = 'slAgain';
      const home = button('Home', '', () => close()); home.id = 'slHome';
      if (friend) dialog('friend', who.name + ' rides with you', [art, el('p', '', 'It chose your helmet light. Every Starling you meet is written in your diary.'), diary()], [again, home]);
      else dialog('shy', who.name + ' is shy today', [art, el('p', '', 'It drifted off to the far rafts. Starlings like a steady echo; listen first, then answer.')], [again, home]);
      announce(friend ? who.name + ' rides with you.' : who.name + ' is shy today.');
    }
    function openMenu() {
      if (phase === 'result' || !dialogWrap.hidden) return;
      const resume = button('Keep listening', 'primary', () => resumeFromMenu()); resume.id = 'slResume';
      const home = button('Home', '', () => close());
      dialog('menu', 'Starlings', [el('p', '', 'A Starling sings lights on four points. Wait for it to finish, then echo the same points with the same rhythm: tap them, use the arrows or WASD, or the d-pad. Three clean echoes and it chooses to ride with you.')], [resume, home]);
    }
    function resumeFromMenu() {
      hideDialog();
      // A paused call starts its verse again; nobody is judged on a song they could not hear.
      if (phase === 'call' || phase === 'listen' || phase === 'answer') { grades = []; sing(now()); }
    }
    function tick(t) {
      if (!dialogWrap.hidden) return;
      const age = t - phaseAt;
      if (phase === 'intro' && age > (calm() ? 300 : 1400)) sing(t);
      else if (phase === 'call') {
        const end = callAt + beats[beats.length - 1].at + 420;
        if (t >= end) setPhase('listen', t);
      } else if (phase === 'listen' && age > LISTEN) { grades = []; sing(t); }
      else if (phase === 'answer') {
        // An unanswered beat is missed once its window has passed.
        const i = grades.length;
        if (i < expect.length && t - answerAt > expect[i].offset + rules.GOOD + 60) {
          const p = expect[i].point, [px, py] = padAt(p);
          grades.push('miss'); pads[p] = t; padHit[p] = 'miss'; fx.push({ kind: 'puff', from: [px, py], at: t });
          if (grades.length >= expect.length) finishVerse(t);
        }
      } else if (phase === 'react' && age > REACT) {
        if (state.phase === 'befriended') befriend(t);
        else if (state.phase === 'shy') { fly = { at: t, shy: true }; setPhase('leaving', t); note(NOTES.down, { dur: .7, vol: .05, slide: .7 }); }
        else sing(t);
      } else if (phase === 'leaving' && age > (calm() ? 500 : LEAVE)) showResult();
    }

    /* ---- Lifecycle ---- */
    function open() {
      if (active) return true;
      if (!rootEl) build();
      codex = rules.readCodex(store.read().codex);
      active = true; rootEl.hidden = false;
      inertSiblings = Array.from(document.body.children).filter(n => n !== rootEl && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)).map(n => ({ node: n, inert: n.inert }));
      for (const { node } of inertSiblings) node.inert = true;
      on(root, 'resize', resize); on(root, 'keydown', onKey, true);
      if (root.visualViewport) on(root.visualViewport, 'resize', resize);
      resize(); syncFriends(); encounter();
      raf = root.requestAnimationFrame(frame);
      try { points.up.focus({ preventScroll: true }); } catch (_) {}
      return true;
    }
    function close() {
      if (!active) return;
      active = false; rootEl.hidden = true; hideDialog();
      for (const { node, inert } of inertSiblings) node.inert = inert; inertSiblings = [];
      if (raf) root.cancelAnimationFrame(raf); raf = 0;
      while (listeners.length) listeners.pop()();
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    function padAt(p) { const [dx, dy] = DIRS[p]; return [layout.cx + dx * layout.reach, layout.cy + dy * layout.reach]; }
    function resize() {
      if (!active) return;
      const r = rootEl.getBoundingClientRect();
      width = Math.max(1, Math.round(r.width)); height = Math.max(1, Math.round(r.height)); dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      const probe = getComputedStyle(rootEl), inset = n => parseFloat(probe.getPropertyValue(n)) || 0;
      const top = inset('--sl-top') + 70, bottom = inset('--sl-bottom'), wide = width > height * 1.15;
      // The Starling and its four points sit in the sky; the pilot stands on a raft below (beside them when wide).
      const reach = Math.round(wide ? clamp((height - top - bottom) * .3, 70, 190) : clamp(Math.min(width * .3, (height - top) * .18), 74, 190));
      const cx = Math.round(width / 2), cy = Math.round(wide ? top + (height - top - bottom) * .44 : Math.max(top + reach + 46, top + (height - top - bottom) * .36));
      const pilot = wide ? clamp(height * .3, 90, 170) : clamp(height * .15, 90, 150);
      layout = { wide, cx, cy, reach, r: clamp(reach * .3, 22, 50), pad: clamp(reach * .3, 24, 48),
        pilotX: wide ? Math.round(width * .16) : Math.round(width * .3), pilotSize: pilot, raftY: height - bottom - (wide ? 30 : Math.max(40, height * .07)) };
      layout.pilotY = layout.raftY - pilot * .46;
      cueEl.style.top = Math.round(wide ? cy + reach + layout.pad + 18 : cy + reach + layout.pad + 22) + 'px';
      for (const p of rules.POINTS) {
        const [x, y] = padAt(p), size = Math.max(64, layout.pad * 2.4), b = points[p];
        b.style.width = b.style.height = size + 'px'; b.style.left = (x - size / 2) + 'px'; b.style.top = (y - size / 2) + 'px';
      }
      sky = backdrop(width, height);
    }
    function backdrop(w, h) {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      const g = c.getContext('2d'); g.scale(dpr, dpr);
      const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, REGION.skyTop); grad.addColorStop(1, REGION.horizon);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      const r = rules.rng(11);
      sprite(g, REGION.accent, w * .2, h * .25, w * .5, .12); sprite(g, '#9FF1FF', w * .85, h * .6, w * .45, .08);
      for (let i = 0; i < Math.round(w * h / 2400); i++) {
        const x = r() * w, y = r() * h * .85, s = r();
        g.globalAlpha = .25 + s * .6; g.fillStyle = s > .9 ? REGION.gold : s > .6 ? '#CFFFE0' : '#E6FFF2';
        g.fillRect(x, y, s > .82 ? 2 : 1, s > .82 ? 2 : 1);
      }
      g.globalAlpha = 1;
      // Far garden rafts: dark floating islands with a lit grass edge.
      for (const [fx, fy, fw] of [[.12, .62, .16], [.88, .4, .12], [.7, .78, .1]]) raft(g, w * fx, h * fy, w * fw, .35);
      return c;
    }
    function raft(g, x, y, w, alpha) {
      g.save(); g.globalAlpha = alpha;
      g.fillStyle = REGION.soil; g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x - w * .2, y + w * .5, x, y + w * .55); g.quadraticCurveTo(x + w * .25, y + w * .45, x + w / 2, y); g.closePath(); g.fill();
      g.fillStyle = REGION.grass; g.beginPath(); g.ellipse(x, y, w / 2, w * .09, 0, 0, TAU); g.fill();
      g.fillStyle = REGION.accent; g.globalAlpha = alpha * .8; g.beginPath(); g.ellipse(x, y - w * .02, w * .44, w * .05, 0, Math.PI, TAU); g.fill();
      g.restore();
    }
    function onKey(e) {
      if (!active) return;
      const k = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', KeyA: 'left', KeyW: 'up', KeyD: 'right', KeyS: 'down' }[e.code];
      if (e.key === 'Escape') { e.preventDefault(); if (dialogWrap.dataset.kind === 'menu' && !dialogWrap.hidden) resumeFromMenu(); else if (!dialogWrap.hidden) close(); else openMenu(); return; }
      if (!dialogWrap.hidden) {
        if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { e.preventDefault(); moveDialogFocus(k === 'up' || k === 'left' ? -1 : 1); }
        return;
      }
      if (k && !e.repeat) { e.preventDefault(); echo(k); }
    }
    function moveDialogFocus(d) {
      const f = Array.from(dialogEl.querySelectorAll('button')); const i = f.indexOf(document.activeElement);
      const nx = f[clamp(i + d, 0, f.length - 1)]; if (nx) nx.focus();
    }
    function pollPad() {
      const pads = root.navigator.getGamepads ? Array.from(root.navigator.getGamepads() || []).filter(Boolean) : [];
      const p = pads[0]; if (!p) return;
      const btn = i => !!(p.buttons[i] && p.buttons[i].pressed), ax = p.axes || [];
      // Face buttons sit where the points do: X left, Y up, B right, A down.
      const s = { left: btn(14) || btn(2) || ax[0] < -.6, up: btn(12) || btn(3) || ax[1] < -.6, right: btn(15) || btn(1) || ax[0] > .6, down: btn(13) || btn(0) || ax[1] > .6, a: btn(0), b: btn(1), start: btn(9) };
      const edge = k => s[k] && !padPrev[k];
      if (dialogWrap.hidden) { for (const d of ['left', 'up', 'right', 'down']) if (edge(d)) echo(d); if (edge('start')) openMenu(); }
      else {
        if (edge('up') || edge('left')) moveDialogFocus(-1);
        else if (edge('down') && !s.a || edge('right') && !s.b) moveDialogFocus(1);
        if (edge('a') && document.activeElement && dialogEl.contains(document.activeElement)) document.activeElement.click();
        if ((edge('b') || edge('start')) && dialogWrap.dataset.kind === 'menu') resumeFromMenu();
      }
      padPrev = s;
    }

    /* ---- Rendering ---- */
    function frame() {
      raf = 0; if (!active) return;
      const t = now();
      pollPad(); tick(t); draw(t);
      raf = root.requestAnimationFrame(frame);
    }
    function draw(t) {
      const c = ctx, L = layout, still = calm();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.drawImage(sky, 0, 0, width, height);
      // Home raft and the pilot, with the Starlings already riding in their helmet light.
      raft(c, L.pilotX + (L.wide ? 0 : L.pilotSize * .3), L.raftY, L.wide ? L.pilotSize * 1.6 : L.pilotSize * 2.2, 1);
      const sway = still ? 0 : Math.sin(t / 900) * 2;
      const helmet = [L.pilotX, L.pilotY - L.pilotSize * .3];
      if (root.SpaceManArt && root.SpaceManArt.drawAvatar) {
        const look = [clamp((L.cx - L.pilotX) / 300, -1, 1), -.6];
        const mood = phase === 'leaving' && fly && !fly.shy ? 1 : null;
        root.SpaceManArt.drawAvatar(c, L.pilotX, L.pilotY + sway, L.pilotSize, typeof opts.appearance === 'function' ? opts.appearance() : null, { time: still ? 0 : t / 1000, reduceMotion: still, lookX: look[0], lookY: look[1], mood });
      }
      codex.slice(-3).forEach((e, i, arr) => {
        const a = (still ? 0 : t / 1400) + i / arr.length * TAU, h = rules.hue(e.hue);
        const x = helmet[0] + Math.cos(a) * L.pilotSize * .34, y = helmet[1] + Math.sin(a) * L.pilotSize * .12 - 4;
        drawStarling(c, x, y, Math.max(4, L.pilotSize * .045), h, { open: 1, t });
      });
      if (!state) return;
      // Answer points: small floating pads of lit grass, each with a chevron that says which way it is.
      const callT = t - callAt;
      for (const p of rules.POINTS) {
        const [x, y] = padAt(p), [dx, dy] = DIRS[p];
        const sungNow = phase === 'call' && beats.some(b => callT >= b.at && callT < b.at + 360 && b.point === p);
        const echoed = clamp(1 - (t - (pads[p] || -1e9)) / 380, 0, 1);
        const ready = phase === 'listen' || phase === 'answer';
        const hit = padHit[p], tint = sungNow ? hue.core : echoed ? (hit === 'miss' ? '#7E9A92' : hit === 'perfect' ? REGION.gold : REGION.you) : REGION.accent;
        const shake = echoed && hit === 'miss' && !still ? Math.sin(t / 22) * 3 * echoed : 0;
        const lift = sungNow ? 1 : echoed;
        sprite(c, tint, x + shake, y, L.pad * (1.6 + lift), .18 + lift * .5 + (ready ? .08 : 0));
        c.save(); c.translate(x + shake, y);
        c.fillStyle = REGION.soil; c.beginPath(); c.ellipse(0, L.pad * .18, L.pad * .8, L.pad * .42, 0, 0, Math.PI); c.fill();
        c.fillStyle = lift > .05 ? tint : '#2C6B57'; c.globalAlpha = .55 + lift * .45 + (ready ? .1 : 0);
        c.beginPath(); c.ellipse(0, 0, L.pad * .82, L.pad * .32, 0, 0, TAU); c.fill();
        // During the song the points are just rafts where light lands; on your turn they become buttons.
        if (!ready) { c.restore(); continue; }
        c.globalAlpha = .9; c.strokeStyle = lift > .05 ? '#FFFFFF' : '#9FE8C0'; c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round';
        // The chevron points away from the Starling: left, up, right or down.
        const s = L.pad * .2;
        c.beginPath();
        if (dx) { c.moveTo(-dx * s * .4, -s * .6); c.lineTo(dx * s * .5, 0); c.lineTo(-dx * s * .4, s * .6); }
        else { c.moveTo(-s * .7, dy * s * .3 - dy * s * .35); c.lineTo(0, dy * s * .3 + dy * s * .2); c.lineTo(s * .7, dy * s * .3 - dy * s * .35); }
        c.stroke(); c.restore();
      }
      // First Starling ever: a breathing ring shows where the echo starts, until the first answer.
      if (phase === 'listen' && !codex.length && state.verse === 0 && expect[0]) {
        const [x, y] = padAt(expect[0].point), k = still ? .5 : .5 + .5 * Math.sin(t / 240);
        c.save(); c.strokeStyle = REGION.gold; c.globalAlpha = .5 + k * .5; c.lineWidth = 3; c.beginPath(); c.arc(x, y, L.pad * (1.05 + k * .2), 0, TAU); c.stroke();
        c.restore();
      }
      // The Starling: drifts in, bobs while it sings, fans its petals as trust grows.
      let x = L.cx, y = L.cy, alpha = 1, size = L.r, open = .35 + state.trust * .2;
      const age = t - phaseAt;
      if (phase === 'intro') { const k = still ? 1 : ease(age / 1300); x = L.cx + (1 - k) * width * .35; y = L.cy - (1 - k) * 60; alpha = k; open = .2; }
      if (!still) y += Math.sin(t / 520) * 5;
      if (phase === 'react') open = lastClean ? clamp(open + .4 * Math.sin(Math.min(1, age / REACT) * Math.PI), 0, 1) : clamp(open - .25 * Math.sin(Math.min(1, age / REACT) * Math.PI), 0, 1);
      if (state.phase === 'shy' && phase !== 'react') open = 0;
      if (phase === 'leaving' && fly) {
        const k = still ? 1 : ease((t - fly.at) / LEAVE);
        if (fly.shy) { y = L.cy - k * height * .5; x = L.cx + k * width * .25; alpha = 1 - k; }
        else { x = L.cx + (helmet[0] - L.cx) * k; y = L.cy + (helmet[1] - L.cy) * k - Math.sin(k * Math.PI) * 80; size = L.r * (1 - k * .8); open = 1; }
      }
      // Singing pulses: a mote of light flies from the Starling to the point it sings.
      let boost = 0;
      if (phase === 'call') for (const b of beats) {
        const bt = callT - b.at;
        if (bt >= 0 && bt < 360) { boost = Math.max(boost, 1 - bt / 360); const [px, py] = padAt(b.point), k = clamp(bt / 140, 0, 1); sprite(c, hue.core, x + (px - x) * k, y + (py - y) * k, L.pad * .7, .9 * (1 - bt / 360)); }
      }
      // A happy squint through a clean echo; otherwise an occasional blink.
      const blink = phase === 'react' && lastClean ? .6 : still ? 0 : (t % 3600 < 140 ? 1 : 0);
      const lookAt = phase === 'listen' || phase === 'answer' ? [clamp((L.pilotX - x) / 200, -1, 1), .8] : [0, 0];
      drawStarling(c, x, y, size, hue, { open, glowBoost: boost, t: still ? 0 : t, blink, look: lookAt, alpha, trust: state.trust });
      // Echo motes and sparkles.
      fx = fx.filter(f => t - f.at < 700);
      for (const f of fx) {
        const k = (t - f.at) / 700; if (k < 0) continue;
        if (f.kind === 'mote') { const m = ease(k * 2); sprite(c, f.color, f.from[0] + (f.to[0] - f.from[0]) * m, f.from[1] + (f.to[1] - f.from[1]) * m, L.pad * .5, .9 * (1 - k)); }
        else if (f.kind === 'puff') { c.globalAlpha = .5 * (1 - k); c.fillStyle = '#7E9A92'; c.beginPath(); c.arc(f.from[0], f.from[1] - k * 20, 6 + k * 14, 0, TAU); c.fill(); c.globalAlpha = 1; }
        else if (f.kind === 'spark' && !still) { const d = L.r * (1.4 + k * 2.4); sprite(c, f.color, L.cx + Math.cos(f.a) * d, L.cy + Math.sin(f.a) * d, 10, 1 - k); }
      }
    }

    return Object.freeze({
      open, close,
      get active() { return active; },
      get screen() { return !active ? 'closed' : !dialogWrap.hidden ? dialogWrap.dataset.kind : phase; },
      // Test and automation seam: the encounter as the rules see it.
      debug: () => ({ phase, state, starling: who, verse: beats.map(b => ({ at: b.at, point: b.point })), grades: grades.slice(), friends: codex.length, sung }),
    });
  }
  root.SpaceManStarlingUI = Object.freeze({ create, drawStarling });
})(typeof window !== 'undefined' ? window : globalThis);
