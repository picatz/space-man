/* Space Man · Starlings: the befriending call (pure rules)
   A Starling is a small creature of light shed by Old Flare. It sings a short
   call of pulses on four points around it (left, up, right, down) with a
   rhythm, and you echo it in time. A clean echo earns its trust and a longer
   verse; a sloppy one makes it slow down and sing the verse again. Three clean
   verses and it chooses to ride in your helmet light; three missed beats and it
   drifts off, shy today.

   Everything here is data in, data out and seeded, so a call is the same on
   every device and the rules are tested without a browser. src/starling-ui.js
   is presentation only. Nothing is caught, owned, levelled or fought: the
   Starling decides, and the codex is a diary. */
(function (root) {
  'use strict';
  const POINTS = Object.freeze(['left', 'up', 'right', 'down']);
  const TRUST = 3;          // clean verses to befriend
  const SHY = 3;            // missed beats before it drifts off
  const UNIT = 250;         // ms per rhythm unit at tempo 1
  const PERFECT = 90;       // ms either side of the beat
  const GOOD = 220;
  const SLOWEST = 1.4;      // a patient Starling never sings slower than this
  const SYLLABLES = Object.freeze(['to', 'la', 'pim', 'nu', 'ri', 'mo', 'sa', 'ki', 'lu', 'fen', 'bo', 'wi', 'tam', 'el', 'ya', 'zu']);
  // Light colours from SpaceManArt.C and the Bloom region accent.
  const HUES = Object.freeze([
    Object.freeze({ id: 'leaf', core: '#4EF07A', petal: '#1F9E4E', word: 'leaf green' }),
    Object.freeze({ id: 'mist', core: '#9FF1FF', petal: '#38E1FF', word: 'mist blue' }),
    Object.freeze({ id: 'pollen', core: '#FFE59A', petal: '#FFC93C', word: 'pollen gold' }),
  ]);

  // mulberry32: small, fast and identical everywhere.
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const mix = (...n) => n.reduce((h, v) => Math.imul(h ^ (v >>> 0), 0x9E3779B1) >>> 0, 0x2545F491);

  /** The Starling a seed calls up: its name (two seeded syllables) and its light. */
  function starling(seed) {
    const r = rng(mix(seed, 7)), pick = a => a[Math.floor(r() * a.length)];
    let a = pick(SYLLABLES), b = pick(SYLLABLES);
    while (b === a) b = pick(SYLLABLES);
    const name = (a + b).charAt(0).toUpperCase() + (a + b).slice(1);
    return Object.freeze({ seed: seed >>> 0, name, hue: pick(HUES).id });
  }

  /** A new encounter. `friends` is how many Starlings already ride with you; the calls grow with it. */
  function start(seed, friends = 0) {
    return Object.freeze({ seed: seed >>> 0, friends: Math.max(0, friends | 0), verse: 0, take: 0, trust: 0, misses: 0, tempo: 1, phase: 'call' });
  }
  /** Beats in the current verse: two to start, one more per verse, more for a well-travelled pilot. Never above six. */
  const length = s => Math.min(6, 2 + s.verse + Math.min(2, Math.floor(s.friends / 2)));

  /**
   * The current call: beats with a time (ms from the first pulse) and a point.
   * The first verse is an even, slow pulse; later ones swing. No point repeats
   * back to back, and the same verse sung again (a new take) is the same song.
   */
  function verse(s) {
    const r = rng(mix(s.seed, s.verse + 1)), n = length(s), unit = UNIT * s.tempo;
    const beats = [];
    let t = 0, prev = -1;
    for (let i = 0; i < n; i++) {
      let p = Math.floor(r() * 4);
      if (p === prev) p = (p + 1 + Math.floor(r() * 3)) % 4;
      beats.push(Object.freeze({ at: Math.round(t), point: POINTS[p] }));
      prev = p;
      t += unit * (s.verse === 0 ? 2 : [2, 2, 1, 3][Math.floor(r() * 4)]);
    }
    return Object.freeze(beats);
  }

  /**
   * Judge one answered beat. `expected` and `actual` are ms from the start of
   * the answer (the first tap is the downbeat, so the echo can start whenever
   * the pilot is ready). Wrong point or outside the window is a miss.
   */
  function judge(expected, actual, point) {
    if (!expected || point !== expected.point) return 'miss';
    const off = Math.abs(actual - expected.offset);
    return off <= PERFECT ? 'perfect' : off <= GOOD ? 'good' : 'miss';
  }
  /** Expected answer offsets for a verse: the first beat is the downbeat at 0. */
  const answer = beats => Object.freeze(beats.map(b => Object.freeze({ point: b.point, offset: b.at - beats[0].at })));

  /**
   * Fold a finished answer (one grade per beat) into the encounter. Clean:
   * trust grows and the next verse is longer and a touch quicker. Sloppy: the
   * Starling slows down and sings the same verse again; misses add up.
   */
  function respond(s, grades) {
    if (s.phase !== 'call') return s;
    const missed = grades.filter(g => g !== 'perfect' && g !== 'good').length + Math.max(0, length(s) - grades.length);
    if (!missed) {
      const trust = s.trust + 1;
      return Object.freeze({ ...s, trust, verse: s.verse + 1, take: 0, tempo: Math.max(.85, s.tempo * .96), phase: trust >= TRUST ? 'befriended' : 'call' });
    }
    // One stumble can throw a whole verse off the beat, so a verse costs at most two missed beats.
    const misses = s.misses + Math.min(2, missed);
    return Object.freeze({ ...s, misses, take: s.take + 1, tempo: Math.min(SLOWEST, s.tempo * 1.15), phase: misses >= SHY ? 'shy' : 'call' });
  }

  /** A diary entry for the codex, validated so a stored list cannot inject anything odd. */
  function entry(seed, at) { const s = starling(seed); return Object.freeze({ seed: s.seed, name: s.name, hue: s.hue, at: Math.max(0, Math.floor(at) || 0) }); }
  function readCodex(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(), out = [];
    for (const e of list.slice(0, 64)) {
      if (!e || !Number.isInteger(e.seed) || e.seed < 0 || e.seed > 0xffffffff || seen.has(e.seed)) continue;
      seen.add(e.seed); out.push(entry(e.seed, e.at));
    }
    return out;
  }

  const api = Object.freeze({ POINTS, HUES, TRUST, SHY, PERFECT, GOOD, rng, starling, start, length, verse, answer, judge, respond, entry, readCodex,
    hue: id => HUES.find(h => h.id === id) || HUES[0] });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManStarling = api;
})(typeof window !== 'undefined' ? window : globalThis);
