/* Fixed courses: the Daily Course and shareable challenge links. Pure and
   inert — no storage, DOM or network — so parsing is testable on its own.

   World generator versions: a course names the generator that builds it, so a
   link keeps meaning what it meant when it was shared.
     gen 1 — the original uniform scatter (every link shared before gen 2).
     gen 2 — designed segments + pacing director (src/worldgen.js).
   A link without `&v=` is gen 1; new links carry `&v=2`. */
(function () {
  'use strict';
  const DAY_MS = 86400000;
  const SITE = 'https://picatz.github.io/space-man/';
  const GEN = 2;                                                    // what new courses are built with
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

  /* ---- Daily themes -------------------------------------------------------
     Each designed daily (gen 2) runs under one theme: a modifier on the rules
     plus its own segment mix and an opening set piece. Plain data — the world
     generator (src/worldgen.js) and the sim read it; nothing here has effects.
       grav    player gravity multiplier (the generator widens gaps to match)
       enemy   enemy-count multiplier       stars  star-shard multiplier
       ammo    resupply multiplier          flare  flare speed multiplier
       unlock  per-element first-appearance distance overrides (m)
       weights per-segment weight multipliers   opener  set pieces run first */
  const THEMES = [
    { id: 'moon', title: 'MOON HOP', blurb: 'Low gravity. Floaty leaps over wide gaps, and divers love the open sky.',
      grav: 0.8, weights: { longLeap: 2.2, diverGap: 1.8, diverAlley: 1.8, stairsUp: 1.5, zigzag: 1.5 }, opener: ['longLeap'] },
    { id: 'swarm', title: 'ALIEN SWARM', blurb: 'Far more aliens, far more ammo. Chain stomps for giant multipliers.',
      enemy: 1.6, ammo: 1.6, weights: { patrolBridge: 2, stompSteps: 2, gauntlet: 2, shooterNest: 1.4 }, opener: ['patrolBridge'] },
    { id: 'stars', title: 'STAR RUSH', blurb: 'Star trails on every jump and fewer aliens. Sweep every trail.',
      stars: 2.4, enemy: 0.7, weights: { starRush: 2.6, splitPath: 2, longLeap: 1.5, runway: 1.4 }, opener: ['starRush'] },
    { id: 'bridges', title: 'SKY BRIDGES', blurb: 'Narrow ledges and high roads. Precision beats speed today.',
      unlock: { narrow: 300, split: 520 }, weights: { stepping: 2.6, splitPath: 2.6, zigzag: 1.6, turretPerch: 1.3 }, opener: ['stepping'] },
    { id: 'meteor', title: 'METEOR FIELD', blurb: 'Cracked slabs from the first sector on. Never stand still.',
      // The debris lesson (two wide cracked slabs over short gaps) opens the run, inside sector one.
      unlock: { debris: 180 }, weights: { debrisRun: 2.4, stairsDown: 1.4 }, opener: ['introDebris'] },
    { id: 'metal', title: 'HEAVY METAL', blurb: 'Shielded, armored and turreted aliens arrive early. Stomp what shots can’t stop.',
      // Armor first (ledges and split paths wait). Opens on the shielder lesson: ammo to try (the shots bounce), then the stomp that works.
      unlock: { shield: 200, bomber: 650, brute: 900, turret: 1150, narrow: 1350, split: 1550 }, weights: { shieldWall: 2, bruteArena: 2, turretPerch: 2, crossfire: 1.6 }, opener: ['introShield'] },
    { id: 'burn', title: 'AFTERBURNER', blurb: 'The flare runs hot, and boost pads are everywhere. Ride them.',
      flare: 1.06, weights: { boostLaunch: 3, luckyCache: 2, longLeap: 1.4 }, opener: ['boostLaunch'] },
  ];
  // Every theme once per seven-day block, in a per-block shuffled order, and
  // never the same theme two days running (a block that would open with the
  // previous block's last theme swaps its first two days).
  function rawOrder(block) {
    const o = THEMES.map((_, i) => i);
    let s = daySeed('themes:' + block);
    for (let i = o.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1), t = o[i]; o[i] = o[j]; o[j] = t;
    }
    return o;
  }
  function themeIndex(day) {
    const n = Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS), k = THEMES.length;
    const block = Math.floor(n / k), pos = n - block * k, o = rawOrder(block);
    if (o[0] === rawOrder(block - 1)[k - 1]) { const t = o[0]; o[0] = o[1]; o[1] = t; }
    return o[pos];
  }
  function theme(day) { return THEMES[themeIndex(day)]; }

  // '#daily=YYYY-MM-DD[&beat=N][&v=G]' or '#seed=N&beat=N[&v=G]' → { kind, day?, seed, beat, gen }.
  // Anything else — unknown or repeated keys, oversized values, #j= invites,
  // #shot QA states — is ignored (null), never partially applied.
  function parse(hash, now) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw || raw.length > 64) return null;
    const kv = {};
    for (const part of raw.split('&')) {
      const m = /^(daily|seed|beat|v)=([0-9-]{1,10})$/.exec(part);
      if (!m || kv[m[1]] !== undefined) return null;
      kv[m[1]] = m[2];
    }
    if (kv.beat !== undefined && !/^\d{1,7}$/.test(kv.beat)) return null;
    if (kv.v !== undefined && !/^[12]$/.test(kv.v)) return null;       // a generator this build knows
    const beat = kv.beat !== undefined ? parseInt(kv.beat, 10) : 0;
    const gen = kv.v !== undefined ? parseInt(kv.v, 10) : 1;
    if (kv.daily !== undefined) {
      if (kv.seed !== undefined || !validDay(kv.daily, now)) return null;
      return { kind: 'daily', day: kv.daily, seed: daySeed(kv.daily), beat, gen };
    }
    // A bare #seed= stays the QA seed; only a seed WITH a score to beat is a challenge.
    if (kv.seed === undefined || kv.beat === undefined || !/^\d{1,10}$/.test(kv.seed)) return null;
    const seed = parseInt(kv.seed, 10);
    return seed <= 0xFFFFFFFF ? { kind: 'seed', seed, beat, gen } : null;
  }
  function link(course, score) {
    const s = Math.max(0, Math.min(9999999, score | 0));
    return SITE + (course.kind === 'daily' ? '#daily=' + course.day : '#seed=' + (course.seed >>> 0)) + '&beat=' + s
      + ((course.gen | 0) >= 2 ? '&v=' + (course.gen | 0) : '');
  }
  window.SpaceManCourse = { SITE, GEN, THEMES, dayKey, daySeed, validDay, theme, parse, link };
})();
