/* Seasons of the Lantern Reach: one calendar every mode reads.
   Pure date math plus a tiny holder for the state the page computed at boot.
   Modes ask current() and decorate; nothing here touches gameplay, saves or the
   wire, and deterministic captures (SHOT) never set a season, so goldens hold.
   To add an event: one CALENDAR row, then decor in the modes that want it
   (docs/art-direction.md, "Seasons and secrets"). */
(function (root) {
  'use strict';
  // Lunar New Year (m*100+d) through 2030. Extend the table before it runs out.
  const LUNAR = Object.freeze({ 2026: 217, 2027: 206, 2028: 126, 2029: 213, 2030: 203 });
  // Each row: flag (the key modes test), stamp (its logbook entry), name, a short home tagline (tag) and a
  // present-tense line for screen readers, motif (the shared decor family), and when(month, day, date).
  const CALENDAR = Object.freeze([
    Object.freeze({ flag: 'fw', stamp: 'turnover', name: 'Turnover', motif: 'fireworks', tag: 'Turnover · fireworks tonight.',
      line: 'Turnover night. Fireworks over Orbital Dock.',
      when: (m, d) => (m === 12 && d === 31) || (m === 1 && d === 1) }),
    Object.freeze({ flag: 'frost', stamp: 'longnight', name: 'Long Night', motif: 'snow', tag: 'Long Night · frosty visors.',
      line: 'The Long Night. Frost on every visor.',
      when: (m, d) => m === 12 || (m === 1 && d <= 5) }),
    Object.freeze({ flag: 'lunar', stamp: 'lanternweek', name: 'Lantern Week', motif: 'lanterns', tag: 'Lantern Week · lights up.',
      line: 'Lantern Week. Red lanterns over the Reach.',
      when: (m, d, date) => {
        const start = LUNAR[date.getFullYear()];
        if (!start) return false;
        const days = Math.floor((date - new Date(date.getFullYear(), ((start / 100) | 0) - 1, start % 100)) / 864e5);
        return days >= 0 && days < 7;
      } }),
    Object.freeze({ flag: 'blossom', stamp: 'equinox', name: 'Bloom Equinox', motif: 'petals', tag: 'Bloom Equinox · in flower.',
      line: 'Bloom Equinox. The garden moons are flowering.',
      when: (m, d) => m === 3 && d >= 19 && d <= 21 }),
    Object.freeze({ flag: 'dusk', stamp: 'dusk', name: 'Dusk Week', motif: 'lanterns', tag: 'Dusk Week · lanterns are out.',
      line: 'Dusk Week. Old Flare dims and lanterns drift through the Reach.',
      when: (m, d) => m === 10 && d >= 24 }),
  ]);
  // Motif colors, shared by every painter so a season reads the same everywhere.
  const MOTIFS = Object.freeze({
    lanterns: Object.freeze({ dusk: '#FF9A4D', lunar: '#FF5A4E', glow: '#FFD08A' }),
    snow: Object.freeze({ color: '#D8F0FF' }),
    petals: Object.freeze({ color: '#FFBED6' }),
    fireworks: Object.freeze({ colors: Object.freeze(['#FFC93C', '#9FF1FF', '#FF8A6B']) }),
  });

  function off() { return { frost: false, dusk: false, lunar: false, blossom: false, fw: false, bday: 0, events: [] }; }
  // The season for a date. firstRunDate ('YYYY-MM-DD') adds the player's own
  // anniversary: bday is whole years since their first run, on that day only.
  function at(date, { firstRunDate = null } = {}) {
    const s = off();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return s;
    const m = date.getMonth() + 1, d = date.getDate();
    for (const row of CALENDAR) if (row.when(m, d, date)) {
      s[row.flag] = true;
      s.events.push({ flag: row.flag, stamp: row.stamp, name: row.name, tag: row.tag, line: row.line, motif: row.motif });
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

  const api = { CALENDAR, MOTIFS, LUNAR, off, at, headline, lanternColor, set, current };
  root.SpaceManSeasons = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
