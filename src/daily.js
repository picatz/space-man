/* Space Man · Today in the Reach
   One seeded daily for every mode, a streak and a spoiler-free result to
   paste in a chat. Everyone on Earth shares the same UTC day, so a friend's
   "Circuit 1:12.40" was set on the same circuit, at the same pace, as yours.

     run    the Daily Course (src/course.js themes it; index.html owns its record)
     arena  one stage, format and CPU skill
     race   one circuit and CPU pace
     chart  a Constellations puzzle: light a line within `par` of your moves
            while Flare defends perfectly, in at most three tries

   Pure apart from load/save, which take a Storage: no DOM, timers or
   Math.random, so the page, the tests and every player agree on the day. */
(function (root) {
  'use strict';
  const DAY_MS = 86400000;
  const MODES = Object.freeze(['run', 'arena', 'race', 'chart']);
  const CHART_TRIES = 3;
  const VERSION = 1;

  /** The UTC day key (YYYY-MM-DD) for a time in ms. */
  const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
  /** The day before a day key. */
  const prevDay = day => dayKey(Date.parse(day + 'T00:00:00Z') - DAY_MS);
  /** A 32-bit seed for a day and a salt: FNV-1a then a murmur3 finalizer (same mix as src/course.js). */
  function seed(day, salt = '') {
    const s = salt + ':' + day;
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // Mulberry32, so picks are stable across engines.
  function rng(s) {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (list, r) => list[Math.floor(r() * list.length)];
  // Every stage or circuit once per cycle of ids.length days, in a per-cycle
  // shuffle, and never the same one two days running: a cycle that would open
  // with the previous cycle's last pick swaps its first two days (as the Daily
  // Course themes do in src/course.js).
  function cycleOrder(salt, block, k) {
    const o = Array.from({ length: k }, (_, i) => i), r = rng(seed(String(block), salt));
    for (let i = k - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = o[i]; o[i] = o[j]; o[j] = t; }
    return o;
  }
  function rotate(day, salt, ids) {
    const k = ids.length;
    if (!k) return null;
    const n = Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS), block = Math.floor(n / k), o = cycleOrder(salt, block, k);
    if (k > 1 && o[0] === cycleOrder(salt, block - 1, k)[k - 1]) { const t = o[0]; o[0] = o[1]; o[1] = t; }
    return ids[o[n - block * k]];
  }

  /* ---- Today's rules per mode ---- */
  // CPU skill is weighted toward the middle: most days are a fair fight, some a breather, some a test.
  const SKILLS = Object.freeze(['easy', 'normal', 'normal', 'normal', 'hard', 'hard']);
  /** Orbital Arena: { arenaId, format, difficulty } from the stage ids in launcher order. */
  function arena(day, arenaIds) {
    const r = rng(seed(day, 'arena'));
    return Object.freeze({ arenaId: rotate(day, 'arena-stage', arenaIds), format: r() < .62 ? 'duel' : 'ffa', difficulty: pick(SKILLS, r) });
  }
  /** Star Circuit: { trackId, difficulty } from the circuit ids. Three laps, like every shareable time. */
  function race(day, trackIds) {
    const r = rng(seed(day, 'race'));
    return Object.freeze({ trackId: rotate(day, 'race-track', trackIds), difficulty: pick(SKILLS, r) });
  }

  /* ---- Constellations daily chart ----
     A position reached by seeded random play where seat 1 (you) can force a
     line within `par` of its own moves against any defence, and not sooner.
     Two-move charts most days, a three-mover every Sunday. */
  function forcedWin(game, state, n) {
    const me = game.turn(state);
    for (const m of game.moves(state)) {
      const a = game.apply(state, m), o = game.outcome(a);
      if (o) { if (o.seat === me) return true; continue; }
      if (n <= 1) continue;
      let holds = true;
      for (const reply of game.moves(a)) {
        const b = game.apply(a, reply);
        if (game.outcome(b) || !forcedWin(game, b, n - 1)) { holds = false; break; }
      }
      if (holds) return true;
    }
    return false;
  }
  /** Moves that keep a forced line within n of your moves (the chart's answers, for hints and tests). */
  function winningMoves(game, state, n) {
    return game.moves(state).filter(m => {
      const a = game.apply(state, m), o = game.outcome(a);
      if (o) return o.seat === game.turn(state);
      return n > 1 && game.moves(a).every(reply => { const b = game.apply(a, reply); return !game.outcome(b) && forcedWin(game, b, n - 1); });
    });
  }
  const chartCache = new Map();
  /** Today's chart: { day, par, state }, or null without the tabletop kit. Deterministic and memoised per day. */
  function chart(day, kit) {
    const game = kit && kit.LANTERNS;
    if (!game) return null;
    if (chartCache.has(day)) return chartCache.get(day);
    const par = new Date(day + 'T00:00:00Z').getUTCDay() === 0 ? 3 : 2, r = rng(seed(day, 'chart'));
    let found = null;
    for (let tries = 0; !found && tries < 4000; tries++) {
      let s = game.init(1, r() < .5 ? 1 : 2), ok = true;
      const plies = 6 + Math.floor(r() * 6);
      for (let i = 0; i < plies && ok; i++) { const ms = game.moves(s); s = game.apply(s, ms[Math.floor(r() * ms.length)]); if (game.outcome(s)) ok = false; }
      // Both pilots have stars in play, it is your move, and the answer is exactly `par` deep.
      if (!ok || game.turn(s) !== 1 || s.queues[0].length < 2 || s.queues[1].length < 2) continue;
      if (forcedWin(game, s, par - 1) || !forcedWin(game, s, par)) continue;
      found = Object.freeze({ day, par, state: s });
    }
    chartCache.set(day, found);
    return found;
  }

  /* ---- Records: today's results and the streak ----
     sm2.today = { v, day, run, arena, race, chart, streak: { count, best, last } }
       run   { best, runs }          arena { won, lives, tries }
       race  { best, place, tries }  chart { solved (try number, 0 = not yet), tries }
     A day counts toward the streak once any daily is played. Missing a day
     starts a new streak; the best one is kept. */
  const blank = day => ({ v: VERSION, day, run: null, arena: null, race: null, chart: null, streak: { count: 0, best: 0, last: '' } });
  const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  function clean(raw, day) {
    const out = blank(day);
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return out;
    const s = raw.streak || {};
    out.streak = { count: num(s.count, 0, 1e5) || 0, best: num(s.best, 0, 1e5) || 0, last: typeof s.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.last) ? s.last : '' };
    // A streak whose last day is before yesterday has lapsed.
    if (out.streak.last && out.streak.last !== day && out.streak.last !== prevDay(day)) out.streak.count = 0;
    if (raw.day !== day) return out;
    const r = raw.run, a = raw.arena, c = raw.race, h = raw.chart;
    if (r && num(r.best, 0, 1e9) !== null && num(r.runs, 1, 1e6)) out.run = { best: r.best, runs: r.runs };
    if (a && num(a.tries, 1, 1e6)) out.arena = { won: !!a.won, lives: num(a.lives, 0, 9) || 0, tries: a.tries };
    if (c && num(c.tries, 1, 1e6)) out.race = { best: num(c.best, 1, 3600), place: num(c.place, 1, 8), tries: c.tries };
    if (h && num(h.tries, 1, CHART_TRIES)) out.chart = { solved: num(h.solved, 0, CHART_TRIES) || 0, tries: h.tries };
    return out;
  }
  /** Today's record from storage (fresh for a new day, streak carried over). */
  function load(storage, key, now) {
    let raw = null;
    try { raw = JSON.parse(storage.getItem(key) || 'null'); } catch (_) {}
    return clean(raw, dayKey(now));
  }
  function save(storage, key, rec) { try { storage.setItem(key, JSON.stringify(rec)); } catch (_) { /* Private mode still plays. */ } }
  /**
   * Folds one finished daily into today's record and returns { rec, improved }.
   *   run   { score }                 arena { won, lives }
   *   race  { time, place } (time null if unfinished)
   *   chart { started } when a try begins, then { solved } if it lights a line
   * improved is true for a new best (run score, faster time, first win or solve).
   */
  function record(rec, mode, result, now) {
    const day = dayKey(now), next = rec && rec.day === day ? JSON.parse(JSON.stringify(rec)) : clean(rec, day);
    let improved = false;
    if (mode === 'run') {
      const score = Math.max(0, Math.floor(result.score) || 0), old = next.run;
      improved = !old || score > old.best;
      next.run = { best: old ? Math.max(old.best, score) : score, runs: (old ? old.runs : 0) + 1 };
    } else if (mode === 'arena') {
      const old = next.arena, won = !!result.won, lives = won ? Math.max(1, Math.min(9, result.lives | 0)) : 0;
      improved = won && (!old || !old.won || lives > old.lives);
      next.arena = { won: won || !!(old && old.won), lives: Math.max(lives, old ? old.lives : 0), tries: (old ? old.tries : 0) + 1 };
    } else if (mode === 'race') {
      const old = next.race, time = Number.isFinite(result.time) && result.time > 0 ? Math.round(result.time * 100) / 100 : null;
      improved = time !== null && (!old || old.best === null || time < old.best);
      next.race = { best: improved ? time : old ? old.best : null, place: improved ? result.place | 0 || null : old ? old.place : null, tries: (old ? old.tries : 0) + 1 };
    } else if (mode === 'chart') {
      // A try counts from your first star, so leaving mid-chart never buys a free look at Flare's defence.
      const old = next.chart || { solved: 0, tries: 0 };
      if (old.solved) return { rec: next, improved: false };
      if (result.solved) { if (!old.tries) return { rec: next, improved: false }; next.chart = { solved: old.tries, tries: old.tries }; improved = true; }
      else if (old.tries >= CHART_TRIES) return { rec: next, improved: false };   // practice after the day's tries are spent
      else next.chart = { solved: 0, tries: old.tries + 1 };
    } else return { rec: next, improved: false };
    const s = next.streak;
    if (s.last !== day) { s.count = s.last === prevDay(day) ? s.count + 1 : 1; s.last = day; s.best = Math.max(s.best, s.count); }
    return { rec: next, improved };
  }
  /** Is this mode's daily finished for today (scored, won, solved, or out of tries)? */
  function settled(rec, mode) {
    const r = rec && rec[mode];
    if (!r) return false;
    if (mode === 'arena') return r.won;
    if (mode === 'race') return r.best !== null;
    if (mode === 'chart') return !!r.solved || r.tries >= CHART_TRIES;
    return r.runs > 0;
  }
  /** How many dailies were played today. */
  const played = rec => MODES.filter(m => rec && rec[m]).length;

  /* ---- Sharing: a spoiler-free line per mode ---- */
  const clock = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const ORDINAL = ['', '1st', '2nd', '3rd'];
  function results(rec) {
    const r = rec || {};
    return [
      ['Run', r.run ? r.run.best.toLocaleString('en-US') : '—'],
      ['Arena', r.arena ? (r.arena.won ? '✓ ' + '♥'.repeat(r.arena.lives) : '✗') : '—'],
      ['Circuit', r.race ? (r.race.best !== null ? clock(r.race.best) : 'DNF') : '—'],
      ['Chart', r.chart ? (r.chart.solved ? '✓ ' + ORDINAL[r.chart.solved] + ' try' : r.chart.tries >= CHART_TRIES ? '✗' : '…') : '—'],
    ];
  }
  /** The text a player pastes: day, one result per mode, streak, link. */
  function shareText(rec, url) {
    const lines = ['Space Man · Today ' + rec.day, results(rec).map(([k, v]) => k + ' ' + v).join(' · ')];
    if (rec.streak.count > 1) lines.push('✦ ' + rec.streak.count + '-day streak');
    if (url) lines.push(url);
    return lines.join('\n');
  }

  const api = Object.freeze({
    MODES, CHART_TRIES, dayKey, prevDay, seed, arena, race, chart, forcedWin, winningMoves,
    load, save, record, settled, played, results, shareText, clock,
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManDaily = api;
})(typeof window !== 'undefined' ? window : globalThis);
