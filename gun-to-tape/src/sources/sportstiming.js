// Sports Timing Solutions (sportstimingsolutions.co.uk).
// One listing page names every event, and each results page carries every finisher in one go.

import * as cheerio from 'cheerio';
import { athleteKey, formatTime, guessDiscipline, parseDate, parseTimeMs } from '../lib/text.js';

const ORIGIN = 'https://www.sportstimingsolutions.co.uk';
const TIME_RE = /\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?/;

/** Parse /allresults. Returns [{ slug, name, date, type, url }] for every event listed. */
export function parseListing(html) {
  const $ = cheerio.load(html);
  const races = [];
  $('div.sts-row[data-type]').each((_, row) => {
    const href = $(row).find('a[href*="/results/"]').first().attr('href');
    if (!href) return;
    const url = new URL(href, ORIGIN).toString();
    const sub = $(row).find('.sts-row__sub').first().text().replace(/\s+/g, ' ').trim();
    const date = parseDate(sub.split('·')[0]);
    races.push({
      slug: new URL(url).pathname.replace(/^\/results\//, ''),
      name: $(row).find('.sts-row__name').first().text().replace(/\s+/g, ' ').trim(),
      date,
      type: $(row).attr('data-type'),
      url,
    });
  });
  return races;
}

/** Split "Male U23 1 out of 52" into gender, category and category position. */
export function parseCategory(text) {
  const m = String(text ?? '').replace(/\s+/g, ' ').trim().match(/^(Male|Female|Non Binary|Open)?\s*(.*?)\s*(?:(\d+)\s+out of\s+\d+)?$/i);
  if (!m) return { gender: null, category: null, categoryPos: null };
  const g = (m[1] ?? '').toLowerCase();
  return {
    gender: g === 'male' ? 'M' : g === 'female' ? 'F' : null,
    category: m[2] || null,
    categoryPos: m[3] ? Number(m[3]) : null,
  };
}

/** Parse one results page: event details and every finisher. */
export function parseResultsPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const csvHref = $('a[href*="export-run-csv.php"]').first().attr('href') ?? '';
  const eventId = csvHref.match(/[?&]id=(\d+)/)?.[1] ?? null;

  const name = $('h1.sts-header__title').first().text().replace(/\s+/g, ' ').trim();
  const date = parseDate($('.sts-header__meta').first().text());
  const finishersText = $('.sts-chip-outline').first().text();
  const finishers = Number((finishersText.match(/([\d,]+)\s+finishers/i)?.[1] ?? '').replace(/,/g, '')) || null;

  const rows = [];
  let skipped = 0;
  $('#myList > div.sts-row').each((_, row) => {
    const $row = $(row);
    const bib = $row.find('.sts-bib').first().text().trim();
    const nameEl = $row.find('.sts-row__name').first().clone();
    nameEl.find('.sts-badge').remove();
    const athlete = nameEl.text().replace(/\s+/g, ' ').trim();
    const pos = Number($row.find('.sts-rank').first().text().trim());
    if (!athlete || !bib || !Number.isFinite(pos)) { skipped++; return; }

    const sub = $row.find('.sts-row__sub').first();
    const hidden = sub.find('.sts-hide-mobile').first().text().replace(/^[\s·]+/, '');
    const club = sub.clone().children().remove().end().text().replace(/\s+/g, ' ').trim() || null;
    const { gender, category, categoryPos } = parseCategory(hidden);

    const gunMs = parseTimeMs($row.find('.sts-row__time strong').first().text().match(TIME_RE)?.[0]);
    const chipMs = parseTimeMs($row.find('.sts-row__time span').first().text().match(TIME_RE)?.[0]);
    const shown = chipMs ?? gunMs;
    const link = $row.find('a.sts-btn[href*="rcd.php"]').first().attr('href');

    rows.push({
      uid: `${eventId ?? 'x'}-${bib}`,
      position: pos,
      status: shown != null ? 'finished' : 'other',
      name: athlete,
      athleteKey: athleteKey(athlete),
      bib,
      club,
      clubKey: club ? athleteKey(club) : null,
      category,
      gender,
      genderPos: null,
      categoryPos,
      gunMs,
      chipMs,
      timeText: shown == null ? null : formatTime(shown),
      officialUrl: link ? new URL(link, pageUrl).toString() : pageUrl,
    });
  });

  return { eventId, name, date, finishers, rows, skipped };
}

export function sportsTimingAdapter() {
  return {
    id: 'sportstiming',

    async discover(client, { since, until }) {
      const html = await client.getText(`${ORIGIN}/allresults`);
      return parseListing(html).filter((r) => r.date && r.date >= since && r.date <= until);
    },

    async crawl(client, race, { log = () => {} } = {}) {
      const html = await client.getText(race.url);
      const page = parseResultsPage(html, race.url);
      if (page.skipped) log(`  ${race.name}: skipped ${page.skipped} unreadable rows`);
      if (!page.rows.length || !page.eventId) return [];

      const discipline = race.type === 'XCountry' ? 'xc'
        : ['Running', 'XCountry'].includes(race.type) ? guessDiscipline(race.name) : 'other';
      return [{
        event: {
          id: `sportstiming:${page.eventId}`,
          source: 'sportstiming',
          raceName: page.name || race.name,
          distance: null,
          date: page.date ?? race.date,
          venue: null,
          discipline,
          officialUrl: race.url,
          finishers: page.finishers ?? page.rows.length,
        },
        results: page.rows,
      }];
    },
  };
}
