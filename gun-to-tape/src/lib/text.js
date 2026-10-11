// Small text helpers shared by every source.

/** Lower-case, accent-free, single-spaced. Used to match athletes and to apply removals. */
export function athleteKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a finishing time into milliseconds.
 * Accepts 17:09, 1:04:18, 00:33:51 and 17:09.5. Returns null for anything else.
 */
export function parseTimeMs(text) {
  const m = String(text ?? '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, s, frac] = m;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000 + ms;
}

/** Format milliseconds back to m:ss or h:mm:ss. */
export function formatTime(ms) {
  if (ms == null) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/** Parse 11/10/2026 or "11 October 2026" or "11 Oct 2026" to ISO yyyy-mm-dd. Returns null if unreadable. */
export function parseDate(text) {
  // Drop weekday names, commas and the word "of": "Sunday, 11th October, 2026" and "Sunday 12th of July 2026"
  const t = String(text ?? '')
    .replace(/\b(mon|tues?|wednes|thurs?|fri|satur|sun)day\b,?/gi, '')
    .replace(/,/g, ' ')
    .replace(/\bof\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const idx = MONTHS.findIndex((name) => name.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (idx >= 0) return iso(Number(m[3]), idx + 1, Number(m[1]));
  }
  return null;
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Decide road, xc or other from the race name. Triathlon, cycling and the like are 'other'. */
export function guessDiscipline(raceName, distance = '') {
  const t = `${raceName} ${distance}`.toLowerCase();
  if (/(triathlon|duathlon|aquathlon|swim|cycl|sportive|\bbike\b|\bmtb\b|hyrox|obstacle|\bocr\b)/.test(t)) return 'other';
  if (/(cross[- ]country|\bxc\b|x-country|\bnehl\b|harrier league|\bxc league\b)/.test(t)) return 'xc';
  return 'road';
}

/** Escape a value for a SQL literal. Only ever used on text we scraped ourselves. */
export function sql(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/\0/g, '').replace(/'/g, "''")}'`;
}
