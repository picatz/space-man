/* Adaptive CPU skill: a streak of results at one CPU level, and the next level
   to offer when that streak says the match is lopsided. Pure and storage-free;
   Arena and Star Circuit keep their own streak beside their saved choices and
   only ever offer the change on the result card, never make it for the player. */
(function (root) {
  'use strict';
  const LEVELS = Object.freeze(['easy', 'normal', 'hard']);
  const STREAK = 2;
  // streak: { level, n } with n > 0 consecutive wins, n < 0 consecutive losses.
  // outcome: 'win' | 'loss' | anything else (a tie or a mid-pack finish) resets it.
  function record(streak, level, outcome) {
    if (!LEVELS.includes(level)) return { level: 'normal', n: 0 };
    const n = streak && streak.level === level && Number.isInteger(streak.n) ? streak.n : 0;
    if (outcome === 'win') return { level, n: n > 0 ? n + 1 : 1 };
    if (outcome === 'loss') return { level, n: n < 0 ? n - 1 : -1 };
    return { level, n: 0 };
  }
  // The level to offer next, or null: up after STREAK straight wins, down after STREAK straight losses.
  function suggestion(streak) {
    const i = streak ? LEVELS.indexOf(streak.level) : -1;
    if (i < 0) return null;
    if (streak.n >= STREAK && i < LEVELS.length - 1) return LEVELS[i + 1];
    if (streak.n <= -STREAK && i > 0) return LEVELS[i - 1];
    return null;
  }
  function load(storage, key) {
    try { const v = JSON.parse(storage.getItem(key) || 'null'); return v && LEVELS.includes(v.level) && Number.isInteger(v.n) ? v : null; } catch (_) { return null; }
  }
  function save(storage, key, streak) { try { storage.setItem(key, JSON.stringify(streak)); } catch (_) { /* Private mode is playable. */ } }
  root.SpaceManAdapt = Object.freeze({ LEVELS, STREAK, record, suggestion, load, save });
})(typeof window !== 'undefined' ? window : globalThis);
