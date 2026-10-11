// Chip Timing UK (HS Sports), chiptiming.co.uk. Running events only.
//
// /results/?e_sport=running&e_year=YYYY lists every event of the year in a dropdown (id and name, no date).
// /results/?e_sport=running&e_year=YYYY&e_event=ID is the event page. It carries the whole field as JSON in
// <script id="participant-cache" type="application/json">, so one request returns every finisher.
// robots.txt allows everything.

import * as cheerio from 'cheerio';
import { athleteKey, formatTime, guessDiscipline, parseDate, parseTimeMs } from '../lib/text.js';

const BASE = 'https://chiptiming.co.uk';

export const listingUrl = (year) => `${BASE}/results/?e_sport=running&e_year=${year}&e_event=`;
export const eventUrl = (year, id) => `${BASE}/results/?e_sport=running&e_year=${year}&e_event=${id}`;

/** Events in the dropdown: [{ id, name }]. */
export function parseListing(html) {
  const $ = cheerio.load(html);
  return $('select.event option').toArray()
    .map((o) => ({ id: $(o).attr('value'), name: $(o).text().replace(/\s+/g, ' ').trim() }))
    .filter((e) => e.id && e.name);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const intOrNull = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : null);

/** Title, date, place, canonical event link and every participant from one event page. */
export function parseEventPage(html) {
  const $ = cheerio.load(html);
  const name = clean($('section.event-details h1').first().text());
  const info = clean($('section.event-details p.info').first().text());
  const date = parseDate(info.split(' - ')[0].replace(/\b(\d{1,2})(st|nd|rd|th)?\s+([A-Za-z]{3})\s+(\d{4})/, '$1 $3 $4'));
  const venue = clean(info.split(' - ').slice(1).join(' - ')).replace(/,\s*$/, '') || null;
  const action = $('form#results-search, .heading.results.event form').first().attr('action') ?? '';
  const eventLink = action.split('#')[0].split('?')[0] || null;

  let raw = [];
  const cache = $('script#participant-cache').first().text().trim();
  if (cache) {
    try { raw = JSON.parse(cache); } catch { raw = []; }
  }

  let skipped = 0;
  const rows = [];
  for (const p of raw) {
    const fullName = clean(`${p.forename ?? ''} ${p.surname ?? ''}`);
    const gunMs = parseTimeMs(p.gun_time);
    const chipMs = parseTimeMs(p.chip_time);
    const position = intOrNull(p.gun_position);
    if (!fullName || position == null || (gunMs == null && chipMs == null)) { skipped++; continue; }
    const club = clean(p.club) || null;
    const g = String(p.gender ?? '').toLowerCase();
    rows.push({
      uid: String(p.participant_id),
      position,
      status: 'finished',
      name: fullName,
      athleteKey: athleteKey(fullName),
      bib: clean(p.bib_number) || null,
      club,
      clubKey: club ? athleteKey(club) : null,
      category: clean(p.category) || null,
      gender: g.startsWith('m') ? 'M' : g.startsWith('f') ? 'F' : null,
      genderPos: intOrNull(p.gender_position),
      categoryPos: intOrNull(p.category_position),
      gunMs,
      chipMs,
      timeText: formatTime(chipMs ?? gunMs),
      officialUrl: eventLink && p.bib_number ? `${eventLink}${encodeURIComponent(clean(p.bib_number))}/` : eventLink,
    });
  }
  return { name, date, venue, eventLink, rows, skipped, total: raw.length };
}

export function chipTimingAdapter() {
  return {
    id: 'chiptiming',

    // The dropdown has no dates, so every event of the years in the window is a candidate.
    // crawl() reads the real date from the event page and drops events outside the window.
    async discover(client, { since, until, log = () => {} }) {
      const races = [];
      for (let year = Number(until.slice(0, 4)); year >= Number(since.slice(0, 4)); year--) {
        const found = parseListing(await client.getText(listingUrl(year)));
        log(`chiptiming ${year}: ${found.length} events listed`);
        for (const e of found) races.push({ name: e.name, id: e.id, year, since, until, url: eventUrl(year, e.id), date: null });
      }
      return races;
    },

    async crawl(client, race, { log = () => {} } = {}) {
      const page = parseEventPage(await client.getText(race.url));
      if (!page.date) { log(`  ${race.name}: no date found, skipped`); return []; }
      if (page.date < race.since || page.date > race.until) return [];
      if (page.skipped) log(`  ${race.name}: skipped ${page.skipped} unreadable rows`);
      if (!page.rows.length) return [];
      return [{
        event: {
          id: `chiptiming:${race.id}`,
          source: 'chiptiming',
          raceName: page.name || race.name,
          distance: null,
          date: page.date,
          venue: page.venue,
          discipline: guessDiscipline(page.name || race.name, ''),
          officialUrl: page.eventLink ?? race.url,
          finishers: page.rows.length,
        },
        results: page.rows,
      }];
    },
  };
}
