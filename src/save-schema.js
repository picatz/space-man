/* Versioned persistence boundary. The gameplay file can evolve without
   scattering localStorage migrations through UI and physics code. */
(function () {
  'use strict';
  const VERSION = 5;
  const num = (v, fb) => (typeof v === 'number' && isFinite(v) ? v : fb);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});   // strings/arrays must not Object.assign-spread
  // Cosmetic id whitelists — hand-edited saves fall back, never render unknown skins.
  const SUIT_IDS = ['classic', 'mint', 'rose', 'gold', 'lilac', 'coral', 'aurora', 'graphite'];
  const HAT_IDS = ['none', 'antenna', 'sprout', 'beanie', 'halo', 'crown', 'cone', 'catears', 'phones'];
  const FREE_IDS = ['classic', 'mint', 'none', 'antenna'];
  // Rebindable keyboard actions (KeyboardEvent.key, lowercased). Keys the game
  // owns globally can never be bound, and a map with any invalid or duplicate
  // entry falls back whole — a half-applied map could leave an action unreachable.
  // down/dash/rescue/camera/pause/mute are shared across modes: down = brake,
  // dash = Arena dash and Star Circuit boost, rescue = Star Circuit recover,
  // camera = Star Circuit view / runner crew standings. Escape always pauses too.
  const DEFAULT_KEYS = Object.freeze({ left: 'a', right: 'd', jump: 'w', fire: 'f', down: 's', dash: 'shift', rescue: 'r', camera: 'c', pause: 'p', mute: 'm' });
  // R restarts a run, so it stays unbindable; the rescue default is the one
  // allowed way to hold it. Pause and mute (P, M) are ordinary actions now.
  const RESERVED_KEYS = ['escape', 'enter', 'tab', ' ', 'r', '1', '2', '3', '4', '5', '6'];
  const TEXT_SCALES = Object.freeze([1, 1.15, 1.3]);
  function bindableKey(k) { return typeof k === 'string' && k.length > 0 && k.length <= 12 && k === k.toLowerCase() && RESERVED_KEYS.indexOf(k) < 0; }
  function allowedKey(a, k) { return k === DEFAULT_KEYS[a] || bindableKey(k); }
  // Keys a save may not mention yet (older saves have only left/right/jump/fire)
  // take their default, or a spare key when the player already bound it elsewhere.
  const SPARE_KEYS = ['u', 'i', 'o', 'k', 'l', 'n', 'b', 'v', 'z', 'q', 'e', 't', 'y', 'g', 'h'];
  function sanitizeKeys(raw) {
    const k = obj(raw), out = {}, seen = [], missing = [];
    for (const a of Object.keys(DEFAULT_KEYS)) {
      if (k[a] === undefined) { missing.push(a); continue; }
      const v = k[a];
      if (!allowedKey(a, v) || seen.indexOf(v) >= 0) return Object.assign({}, DEFAULT_KEYS);
      out[a] = v; seen.push(v);
    }
    for (const a of missing) {
      const v = seen.indexOf(DEFAULT_KEYS[a]) < 0 ? DEFAULT_KEYS[a] : SPARE_KEYS.find((x) => seen.indexOf(x) < 0);
      out[a] = v; seen.push(v);
    }
    return Object.assign({}, ...Object.keys(DEFAULT_KEYS).map((a) => ({ [a]: out[a] })));   // canonical key order
  }
  // Text size is a closed set so a hand-edited save can never blow the layout up.
  function sanitizeTextScale(v) { return TEXT_SCALES.indexOf(v) >= 0 ? v : 1; }
  // opts.reduceMotion: the OS prefers-reduced-motion answer, used only when the
  // player never chose (the schema can't read media queries itself).
  function migrate(raw, opts) {
    const input = obj(raw);
    const inSet = obj(input.settings);
    const s = Object.assign({ music: true, sfx: true, haptics: true, shake: true, lefty: false, autorun: true }, inSet);
    if (inSet.sound !== undefined) {
      s.music = !!inSet.sound; s.sfx = !!inSet.sound;
    }
    // v4: mixer state + master quick-mute. Corrupt values fall back, never throw.
    s.musicVol = clamp01(num(s.musicVol, 1));
    s.sfxVol = clamp01(num(s.sfxVol, 1));
    s.muted = s.muted === true;
    // Additive a11y fields (no version bump): the reduce-motion switch and key map.
    s.reduceMotion = typeof s.reduceMotion === 'boolean' ? s.reduceMotion : !!(opts && opts.reduceMotion);
    s.keys = sanitizeKeys(s.keys);
    s.uiScale = sanitizeTextScale(s.uiScale);   // text size: 1 / 1.15 / 1.3
    const c = window.SpaceManCosmetics.migrateProfile(input.cosmetics, { stats: input.stats, flags: input.flags });
    if (c.companion === undefined) c.companion = 'default';
    if (c.patches === undefined) c.patches = [];
    return {
      version: VERSION,
      settings: s,
      discoveries: Array.isArray(input.discoveries) ? input.discoveries.slice(0, 64).filter((x) => typeof x === 'string') : [],
      cosmetics: c,
      achievements: Object.assign({}, obj(input.achievements)),
    };
  }
  window.SpaceManSave = { VERSION, migrate, DEFAULT_KEYS, TEXT_SCALES, bindableKey, allowedKey, sanitizeKeys, sanitizeTextScale };
})();
