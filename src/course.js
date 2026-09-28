/* Fixed courses: the Daily Course and shareable challenge links. Pure and
   inert — no storage, DOM or network — so parsing is testable on its own. */
(function () {
  'use strict';
  const DAY_MS = 86400000;
  const SITE = 'https://picatz.github.io/space-man/';
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);   // UTC, so the whole world shares a day
  // FNV-1a over the date string, then a murmur3 finalizer so neighbouring days
  // land far apart in seed space. Everyone computes the same 32-bit seed.
  function daySeed(day) {
    let h = 0x811C9DC5;
    for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // A real calendar day, today or up to a week back (links outlive the day they
  // were shared, but a future date would spoil a course nobody has run yet).
  function validDay(day, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const t = Date.parse(day + 'T00:00:00Z');
    if (!isFinite(t) || dayKey(t) !== day) return false;             // rejects 2026-02-30
    const age = Math.round((Date.parse(dayKey(now) + 'T00:00:00Z') - t) / DAY_MS);
    return age >= 0 && age <= 7;
  }
  // '#daily=YYYY-MM-DD[&beat=N]' or '#seed=N&beat=N' → { kind, day?, seed, beat }.
  // Anything else — unknown or repeated keys, oversized values, #j= invites,
  // #shot QA states — is ignored (null), never partially applied.
  function parse(hash, now) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw || raw.length > 64) return null;
    const kv = {};
    for (const part of raw.split('&')) {
      const m = /^(daily|seed|beat)=([0-9-]{1,10})$/.exec(part);
      if (!m || kv[m[1]] !== undefined) return null;
      kv[m[1]] = m[2];
    }
    if (kv.beat !== undefined && !/^\d{1,7}$/.test(kv.beat)) return null;
    const beat = kv.beat !== undefined ? parseInt(kv.beat, 10) : 0;
    if (kv.daily !== undefined) {
      if (kv.seed !== undefined || !validDay(kv.daily, now)) return null;
      return { kind: 'daily', day: kv.daily, seed: daySeed(kv.daily), beat };
    }
    // A bare #seed= stays the QA seed; only a seed WITH a score to beat is a challenge.
    if (kv.seed === undefined || kv.beat === undefined || !/^\d{1,10}$/.test(kv.seed)) return null;
    const seed = parseInt(kv.seed, 10);
    return seed <= 0xFFFFFFFF ? { kind: 'seed', seed, beat } : null;
  }
  function link(course, score) {
    const s = Math.max(0, Math.min(9999999, score | 0));
    return SITE + (course.kind === 'daily' ? '#daily=' + course.day : '#seed=' + (course.seed >>> 0)) + '&beat=' + s;
  }
  window.SpaceManCourse = { SITE, dayKey, daySeed, validDay, parse, link };
})();
