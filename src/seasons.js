/* Seasons: one holiday calendar every mode reads. Real holidays lead (a player
   should recognise Halloween at a glance); the Lantern Reach's names are flavor.
   Pure date math plus a tiny holder for the state the page computed at boot.
   Modes ask current() and decorate; nothing here touches gameplay, saves or the
   wire, and deterministic captures (SHOT) never set a season, so goldens hold.
   To add an event: one CALENDAR row, then decor in the modes that want it
   (docs/art-direction.md, "Seasons and secrets"). */
(function (root) {
  'use strict';
  // Lunar New Year (m*100+d) through 2030. Extend the table before it runs out.
  const LUNAR = Object.freeze({ 2026: 217, 2027: 206, 2028: 126, 2029: 213, 2030: 203 });
  // Fourth Thursday of November (US Thanksgiving) for a year, as a Date at local midnight.
  function thanksgiving(year) { const first = new Date(year, 10, 1).getDay(); return new Date(year, 10, 1 + ((4 - first + 7) % 7) + 21); }
  // Each row: flag (the key modes test), stamp (its logbook entry), name (the real holiday, always first in
  // anything a player reads), lore (the Lantern Reach's own name for it, as flavor), a short home tagline (tag),
  // a present-tense line for screen readers, motif (the shared decor family), optional also (extra flags it
  // turns on, so the runner's fireworks fly on the Fourth too) and when(month, day, date).
  // Rows are in headline order: a holiday beats the season it falls in. US holidays first; to add another
  // country's, add rows here and a MOTIFS family, then decor in src/art.js homeSeason.
  const CALENDAR = Object.freeze([
    Object.freeze({ flag: 'fw', stamp: 'turnover', name: 'New Year', lore: 'Turnover', motif: 'fireworks', tag: 'Happy New Year! Fireworks up',
      line: 'Happy New Year! Turnover night in the Reach, with fireworks over Orbital Dock.',
      when: (m, d) => (m === 12 && d === 31) || (m === 1 && d === 1) }),
    Object.freeze({ flag: 'july4', stamp: 'july4', name: 'Fourth of July', lore: 'Founders’ Night', motif: 'fireworks', also: Object.freeze(['fw']), tag: 'Fourth of July · fireworks!',
      line: 'Happy Fourth of July! Red, white and blue fireworks over the Reach.',
      when: (m, d) => m === 7 && (d === 3 || d === 4) }),
    Object.freeze({ flag: 'dusk', stamp: 'dusk', name: 'Halloween', lore: 'Dusk Week', motif: 'pumpkins', tag: 'Halloween · pumpkins are out',
      line: 'Happy Halloween! Old Flare dims and jack-o’-lanterns drift through the Reach.',
      when: (m, d) => m === 10 && d >= 24 }),
    Object.freeze({ flag: 'harvest', stamp: 'harvest', name: 'Thanksgiving', lore: 'Harvest Moon', motif: 'harvest', tag: 'Happy Thanksgiving, pilot',
      line: 'Happy Thanksgiving! The garden moons bring in the harvest.',
      when: (m, d, date) => { const days = Math.round((new Date(date.getFullYear(), m - 1, d) - thanksgiving(date.getFullYear())) / 864e5); return days >= -1 && days <= 3; } }),
    Object.freeze({ flag: 'hearts', stamp: 'valentine', name: 'Valentine’s Day', lore: 'Heartlight', motif: 'hearts', tag: 'Valentine’s Day · hearts up',
      line: 'Happy Valentine’s Day! Hearts float through the Reach.',
      when: (m, d) => m === 2 && d >= 12 && d <= 14 }),
    Object.freeze({ flag: 'clover', stamp: 'clover', name: 'St. Patrick’s Day', lore: 'Lucky Orbit', motif: 'clovers', tag: 'St. Patrick’s Day · lucky run',
      line: 'Happy St. Patrick’s Day! Clovers drift by, and there is gold on the pad.',
      when: (m, d) => m === 3 && d >= 15 && d <= 17 }),
    Object.freeze({ flag: 'lunar', stamp: 'lanternweek', name: 'Lunar New Year', lore: 'Lantern Week', motif: 'lanterns', tag: 'Lunar New Year · lanterns up',
      line: 'Happy Lunar New Year! Red lanterns rise over the Reach.',
      when: (m, d, date) => {
        const start = LUNAR[date.getFullYear()];
        if (!start) return false;
        const days = Math.floor((date - new Date(date.getFullYear(), ((start / 100) | 0) - 1, start % 100)) / 864e5);
        return days >= 0 && days < 7;
      } }),
    Object.freeze({ flag: 'blossom', stamp: 'equinox', name: 'Spring equinox', lore: 'Bloom Equinox', motif: 'petals', tag: 'Spring equinox · in bloom',
      line: 'Spring is here. The garden moons are flowering.',
      when: (m, d) => m === 3 && d >= 19 && d <= 21 }),
    Object.freeze({ flag: 'frost', stamp: 'longnight', name: 'Winter holidays', lore: 'The Long Night', motif: 'snow', tag: 'Happy holidays · let it snow',
      line: 'Happy holidays! Snow on the pad and frost on every visor.',
      when: (m, d) => m === 12 || (m === 1 && d <= 5) }),
  ]);
  // Motif colors, shared by every painter so a season reads the same everywhere.
  const MOTIFS = Object.freeze({
    lanterns: Object.freeze({ dusk: '#FF9A4D', lunar: '#FF5A4E', glow: '#FFD08A' }),
    pumpkins: Object.freeze({ color: '#FF8A3D', glow: '#FFB25A' }),
    harvest: Object.freeze({ colors: Object.freeze(['#D9632B', '#E8A33A', '#B4472A', '#C98A2E']) }),
    hearts: Object.freeze({ color: '#FF5A7A', light: '#FFB3C4' }),
    clovers: Object.freeze({ color: '#3FBF62', gold: '#FFC93C' }),
    snow: Object.freeze({ color: '#D8F0FF' }),
    petals: Object.freeze({ color: '#FFBED6' }),
    fireworks: Object.freeze({ colors: Object.freeze(['#FFC93C', '#9FF1FF', '#FF8A6B']), july4: Object.freeze(['#FF4F5E', '#FFFFFF', '#5A8CFF']) }),
  });

  function off() { return { frost: false, dusk: false, lunar: false, blossom: false, fw: false, july4: false, harvest: false, hearts: false, clover: false, bday: 0, events: [] }; }
  // The season for a date. firstRunDate ('YYYY-MM-DD') adds the player's own
  // anniversary: bday is whole years since their first run, on that day only.
  function at(date, { firstRunDate = null } = {}) {
    const s = off();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return s;
    const m = date.getMonth() + 1, d = date.getDate();
    for (const row of CALENDAR) if (row.when(m, d, date)) {
      s[row.flag] = true;
      if (row.also) for (const flag of row.also) s[flag] = true;
      s.events.push({ flag: row.flag, stamp: row.stamp, name: row.name, lore: row.lore, tag: row.tag, line: row.line, motif: row.motif });
    }
    if (typeof firstRunDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(firstRunDate)) {
      const years = date.getFullYear() - +firstRunDate.slice(0, 4);
      if (years >= 1 && m === +firstRunDate.slice(5, 7) && d === +firstRunDate.slice(8, 10)) {
        s.bday = years;
        s.events.push({ flag: 'bday', name: 'Anniversary', motif: 'fireworks', tag: 'Happy ' + years + (years === 1 ? ' year' : ' years') + ', pilot.',
          line: years === 1 ? 'One year of Space Man together. Thank you, pilot.' : years + ' years of Space Man together. Thank you, pilot.' });
      }
    }
    return s;
  }
  // The first event wins the headline; lanterns for whichever lantern season is on.
  function headline(s) { return s && s.events && s.events.length ? s.events[0] : null; }
  function lanternColor(s) { return s && s.lunar ? MOTIFS.lanterns.lunar : s && s.dusk ? MOTIFS.lanterns.dusk : null; }

  let state = off();
  // The page sets the season once at boot (and again if the date rolls over).
  function set(next) { state = next && typeof next === 'object' ? next : off(); return state; }
  function current() { return state; }

  const api = { CALENDAR, MOTIFS, LUNAR, thanksgiving, off, at, headline, lanternColor, set, current };
  root.SpaceManSeasons = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
