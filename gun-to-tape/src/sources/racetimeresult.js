// Race Time Result (racetimeresult.co.uk). Their results pages embed Race Roster, so this reads
// the Race Roster results API (results.raceroster.com/v2/api). Both robots.txt files allow it.
//
//   /results/results-YYYY            dropdown of event pages (data-pageurl)
//   /results/results-YYYY/<pageurl>  page embedding results.raceroster.com/v3/events/<code>
//   /v2/api/events/<code>            event info and sub-events (distances)
//   /v2/api/result-events/<resultEventId>/sub-events/<subEventId>/results?start=&limit=   rows (limit must be 50 or more)

import * as cheerio from 'cheerio';
import { athleteKey, formatTime, guessDiscipline, parseTimeMs } from '../lib/text.js';

const SITE = 'https://www.racetimeresult.co.uk';
const RR = 'https://results.raceroster.com';
const PAGE_SIZE = 250;

export const listingUrl = (year) => `${SITE}/results/results-${year}`;
export const eventPageUrl = (year, pageUrl) => `${SITE}/results/results-${year}/${pageUrl}`;

/** Events in the dropdown: [{ pageUrl, name }]. */
export function parseListing(html) {
  const $ = cheerio.load(html);
  return $('select#eventselector option[data-pageurl]').toArray()
    .map((o) => ({ pageUrl: $(o).attr('data-pageurl'), name: $(o).text().replace(/\s+/g, ' ').trim() }))
    .filter((e) => e.pageUrl && e.name);
}

/** The Race Roster event code embedded in an event page, or null. */
export function findRaceRosterCode(html) {
  const m = String(html).match(/results\.raceroster\.com\/v3\/events\/([a-z0-9]{8,})/i);
  return m ? m[1] : null;
}

/** Local calendar date of an event, from its ISO timestamp and IANA timezone. */
export function localDate(iso, timezone = 'Europe/London') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Race Roster event JSON -> what the crawler needs. Only running sub-events with results are kept. */
export function parseEventInfo(json) {
  const e = json?.data?.event;
  if (!e) return null;
  const subEvents = (e.subEvents ?? [])
    .filter((s) => s.hasResults && s.isPublic && s.resultsType === 'STRUCTURED' && (s.distanceType ?? 'running') === 'running')
    .map((s) => ({
      id: s.id,
      name: s.name,
      distance: s.distanceLabel || null,
      count: s.resultCount ?? null,
      genderCounts: s.genderParticipantCount ?? {},
    }));
  return {
    resultEventId: e.id,
    code: e.uniqueCode,
    name: e.name,
    date: localDate(e.eventDate, e.timezone),
    venue: [e.locality, e.administrativeArea].filter(Boolean).join(', ') || null,
    countryCode: e.countryCode ?? null,
    resultsUrl: e.resultsUrl || `${RR}/v3/events/${e.uniqueCode}`,
    subEvents,
  };
}

const placeOf = (text) => {
  const m = String(text ?? '').match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
};
const totalOf = (text) => {
  const m = String(text ?? '').match(/\/\s*(\d+)/);
  return m ? Number(m[1]) : null;
};

/** One page of result rows. genderCounts ({M, F}) lets "1 / 551" tell us which sex the row belongs to. */
export function parseResultRows(json, { eventUrl, subEventId, genderCounts = {} }) {
  const out = [];
  let skipped = 0;
  for (const r of json?.data ?? []) {
    const position = typeof r.overallPlace === 'number' ? r.overallPlace : placeOf(r.overallPlace);
    const gunMs = parseTimeMs(r.gunTime);
    const chipMs = parseTimeMs(r.chipTime);
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || position == null || (gunMs == null && chipMs == null)) { skipped++; continue; }

    const division = String(r.division ?? '').trim();
    let gender = /^M\b/i.test(division) ? 'M' : /^F\b/i.test(division) ? 'F' : null;
    if (!gender) {
      const total = totalOf(r.genderPlace);
      if (total != null && total === genderCounts.M && total !== genderCounts.F) gender = 'M';
      else if (total != null && total === genderCounts.F && total !== genderCounts.M) gender = 'F';
    }
    const club = String(r.teamName ?? '').trim() || null;
    out.push({
      uid: String(r.id),
      position,
      status: 'finished',
      name,
      athleteKey: athleteKey(name),
      bib: r.bib ? String(r.bib) : null,
      club,
      clubKey: club ? athleteKey(club) : null,
      category: division || null,
      gender,
      genderPos: placeOf(r.genderPlace),
      categoryPos: placeOf(r.divisionPlace),
      gunMs,
      chipMs,
      timeText: formatTime(chipMs ?? gunMs),
      officialUrl: `${eventUrl}/race/${subEventId}/participant/${r.id}`,
    });
  }
  return { rows: out, skipped, total: json?.meta?.totalResults ?? null };
}

export function raceTimeResultAdapter() {
  const getJson = async (client, url) => JSON.parse(await client.getText(url));

  return {
    id: 'racetimeresult',

    async discover(client, { since, until, log = () => {} }) {
      const races = [];
      for (let year = Number(until.slice(0, 4)); year >= Number(since.slice(0, 4)); year--) {
        const found = parseListing(await client.getText(listingUrl(year)));
        log(`racetimeresult ${year}: ${found.length} events listed`);
        for (const e of found) races.push({ name: e.name, url: eventPageUrl(year, e.pageUrl), since, until, date: null });
      }
      return races;
    },

    async crawl(client, race, { log = () => {} } = {}) {
      const code = findRaceRosterCode(await client.getText(race.url));
      if (!code) { log(`  ${race.name}: no Race Roster results embedded, skipped`); return []; }

      const info = parseEventInfo(await getJson(client, `${RR}/v2/api/events/${code}`));
      if (!info?.date) return [];
      if (info.date < race.since || info.date > race.until) return [];
      if (info.countryCode && info.countryCode !== 'GB') return [];

      const eventUrl = info.resultsUrl.replace(/\/$/, '');
      const out = [];
      for (const sub of info.subEvents) {
        const rows = [];
        let total = sub.count;
        for (let start = 0; ; start += PAGE_SIZE) {
          const url = `${RR}/v2/api/result-events/${info.resultEventId}/sub-events/${sub.id}/results?start=${start}&limit=${PAGE_SIZE}`;
          const page = parseResultRows(await getJson(client, url), { eventUrl, subEventId: sub.id, genderCounts: sub.genderCounts });
          if (page.skipped) log(`  ${info.name} / ${sub.name}: skipped ${page.skipped} unreadable rows`);
          rows.push(...page.rows);
          total = page.total ?? total;
          if (!page.rows.length || (total != null && start + PAGE_SIZE >= total)) break;
        }
        if (!rows.length) continue;
        const sameAsEvent = sub.name && sub.name.toLowerCase() === info.name.toLowerCase();
        out.push({
          event: {
            id: `racetimeresult:${code}-${sub.id}`,
            source: 'racetimeresult',
            raceName: info.name,
            distance: sameAsEvent ? sub.distance : (sub.name || sub.distance),
            date: info.date,
            venue: info.venue,
            discipline: guessDiscipline(info.name, sub.name ?? ''),
            officialUrl: `${eventUrl}/race/${sub.id}`,
            finishers: total ?? rows.length,
          },
          results: rows,
        });
      }
      return out;
    },
  };
}
