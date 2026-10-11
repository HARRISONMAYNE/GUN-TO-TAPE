// Racetec results platform. Used by racetecresults.com and by timers on their own domains,
// for example results.runthrough.co.uk. Every customer has a CId, every race an RId and
// every distance within a race an EId.
//
// Parsing is header-driven, because each customer's skin shows a different set of columns.

import * as cheerio from 'cheerio';
import { athleteKey, formatTime, guessDiscipline, parseDate, parseTimeMs } from '../lib/text.js';

const TIME_RE = /\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?/;

/**
 * Parse one page of the race listing (StartPage.aspx).
 * Returns every race link with its date. Upcoming races are included, the caller filters by date.
 */
export function parseListing(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const seen = new Map();

  $('a[href*="results.aspx?CId="]').each((_, a) => {
    const href = new URL($(a).attr('href'), base);
    const cid = href.searchParams.get('CId');
    const rid = href.searchParams.get('RId');
    if (!cid || !rid || href.searchParams.has('EId')) return;
    // Thumbnail and date links come first in some skins (Resultsbase puts the date inside the first link).
    // The text link with the race name follows, so skip any link that wraps an image or a date.
    if ($(a).find('img, .race-date').length) return;
    const name = $(a).text().replace(/\s+/g, ' ').trim();
    if (!name) return;

    // The date sits in the same card. Climb until a block holds one.
    let date = null;
    let node = $(a);
    for (let i = 0; i < 4 && !date; i++) {
      node = node.parent();
      node.find('span, div, p').each((__, el) => {
        if (date) return;
        const own = $(el).clone().children().remove().end().text().trim();
        const parsed = parseDate(own);
        if (parsed) date = parsed;
      });
      if (!date) {
        // Racetec skin: the date is a text node after the link
        const siblingText = node.text().replace(/\s+/g, ' ');
        const m = siblingText.match(/(\d{1,2} [A-Za-z]+ \d{4}|\d{1,2}\/\d{1,2}\/\d{4})/);
        if (m) date = parseDate(m[1]);
      }
    }

    const key = `${cid}-${rid}`;
    if (!seen.has(key)) {
      seen.set(key, { customerId: cid, raceId: rid, name, date, url: `${base.origin}/results.aspx?CId=${cid}&RId=${rid}` });
    }
  });

  return [...seen.values()];
}

/** Find the From/To window of the next listing page, or null on the last page. */
export function nextListingUrl(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const links = $('ul.pagination a.page-link, #divAllPager a').toArray()
    .map((a) => $(a).attr('href'))
    .filter(Boolean)
    .map((h) => new URL(h, base))
    .filter((u) => u.searchParams.has('From'));
  const currentFrom = Number(base.searchParams.get('From') ?? 1);
  const later = links
    .map((u) => ({ u, from: Number(u.searchParams.get('From')) }))
    .filter((x) => x.from > currentFrom)
    .sort((a, b) => a.from - b.from)[0];
  return later ? later.u.toString() : null;
}

/** The distances (tabs) inside a race: [{ eventId, label }]. A race with one distance has no tabs. */
export function parseEventTabs(html) {
  const $ = cheerio.load(html);
  const tabs = $('ul[id$="divEvents"] a.nav-link').toArray().map((a) => {
    const href = $(a).attr('href') ?? '';
    const eventId = new URL(href, 'https://x.invalid').searchParams.get('EId');
    return { eventId, label: $(a).text().replace(/\s+/g, ' ').trim() };
  }).filter((t) => t.eventId);
  if (tabs.length) return tabs;

  // No tabs: the page shows a single distance. Read its EId from any results link.
  const eid = $('a[href*="EId="]').first().attr('href');
  const id = eid ? new URL(eid, 'https://x.invalid').searchParams.get('EId') : '1';
  const title = $('.rtv3-meta-title').first().text().trim();
  return [{ eventId: id ?? '1', label: title }];
}

/** "334 results · page 1 of 7" */
export function parsePaging(html) {
  const $ = cheerio.load(html);
  const text = $('.rtv3-viewbar-count').first().text() || $('body').text();
  const m = text.match(/(\d[\d,]*)\s+results?\s*[·.\-]?\s*page\s+(\d+)\s+of\s+(\d+)/i);
  if (!m) return { total: null, page: 1, pages: 1 };
  return { total: Number(m[1].replace(/,/g, '')), page: Number(m[2]), pages: Number(m[3]) };
}

/** First text of a cell, ignoring the small sub-lines (rtv3-sub) underneath it. */
function mainText($, cell) {
  const clone = $(cell).clone();
  clone.find('.rtv3-sub, br, script').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

function toInt(text) {
  const m = String(text ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * Parse the results table on one page.
 * @returns {{ rows: object[], skipped: number }}
 */
export function parseResultsPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const table = $('table[id$="tblResults"]').first();
  if (!table.length) return { rows: [], skipped: 0 };

  // Header cells give column positions. "Name" appears twice (desktop and mobile), keep the first.
  const headers = table.find('thead tr').first().children('td, th').toArray()
    .map((c) => $(c).text().replace(/\s+/g, ' ').trim().toLowerCase());
  const col = (...names) => headers.findIndex((h) => names.includes(h));
  const idx = {
    pos: col('pos', 'position', 'overall'),
    name: col('name'),
    club: col('club'),
    category: col('category', 'cat'),
    gender: col('gender', 'sex'),
    genderPos: col('gen pos', 'gender pos'),
    gun: col('gun time', 'time', 'gun'),
    chip: col('chip time', 'net time', 'chip', 'net'),
  };

  const rows = [];
  let skipped = 0;
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray();
    const link = $(tr).find('a[href*="myresults.aspx"]').first().attr('href') ?? $(tr).attr('data-href');
    if (!link || cells.length < 4) { skipped++; return; }
    const url = new URL(link, base);
    const uid = url.searchParams.get('uid');
    if (!uid) { skipped++; return; }

    const cell = (i) => (i >= 0 && cells[i] ? cells[i] : null);

    const nameCell = cell(idx.name);
    const name = (nameCell ? $(nameCell).find('a.grid-name').first().text() : $(tr).find('a.grid-name').first().text())
      .replace(/\s+#\d+\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!name) { skipped++; return; }
    const bibMatch = (nameCell ? $(nameCell).text() : '').match(/#(\w+)/);

    const posCell = cell(idx.pos);
    const posText = posCell ? ($(posCell).find('.rtv3-pos').first().text() || mainText($, posCell)) : '';
    const position = /^\d+$/.test(posText.trim()) ? Number(posText.trim()) : null;

    const catCell = cell(idx.category);
    const catLink = catCell ? $(catCell).find('a').first() : null;
    const category = catCell ? (catLink?.text().trim() || mainText($, catCell)) || null : null;
    const catPosText = catCell ? $(catCell).find('.rtv3-sub').first().text() : '';
    const categoryPos = /of/.test(catPosText) ? toInt(catPosText) : null;

    // Gender comes from the category link (g=1 male, g=2 female), or the gender column text.
    let gender = null;
    const gParam = catLink?.attr('href') ? new URL(catLink.attr('href'), base).searchParams.get('g') : null;
    if (gParam === '1') gender = 'M';
    else if (gParam === '2') gender = 'F';
    const genderCell = cell(idx.gender);
    if (!gender && genderCell) {
      const g = mainText($, genderCell).toLowerCase();
      if (g.startsWith('m')) gender = 'M'; else if (g.startsWith('f')) gender = 'F';
    }
    const genderPosText = genderCell ? $(genderCell).find('.rtv3-sub').first().text() : '';
    const genderPos = idx.genderPos >= 0 ? toInt(mainText($, cells[idx.genderPos])) : (/of/.test(genderPosText) ? toInt(genderPosText) : null);

    const timeOf = (i) => {
      const c = cell(i);
      if (!c) return null;
      const m = mainText($, c).match(TIME_RE);
      return m ? parseTimeMs(m[0]) : null;
    };
    const gunMs = timeOf(idx.gun);
    const chipMs = timeOf(idx.chip);
    const shown = chipMs ?? gunMs;

    const status = shown != null && position != null ? 'finished'
      : /dq|disq/i.test($(tr).text()) ? 'dq'
      : /dnf/i.test($(tr).text()) ? 'dnf' : 'other';

    const clubCell = cell(idx.club);
    const club = clubCell ? mainText($, clubCell) || null : null;

    rows.push({
      uid,
      position,
      status,
      name,
      athleteKey: athleteKey(name),
      bib: bibMatch ? bibMatch[1] : null,
      club,
      clubKey: club ? athleteKey(club) : null,
      category,
      gender,
      genderPos,
      categoryPos,
      gunMs,
      chipMs,
      timeText: formatTime(shown),
      officialUrl: `${base.origin}/myresults.aspx?uid=${uid}`,
    });
  });

  return { rows, skipped };
}

/**
 * Crawl one race: every distance, every page. Yields event and result records ready to store.
 * @param {import('../lib/http.js').PoliteClient} client
 */
export async function crawlRace(client, race, { log = () => {} } = {}) {
  const firstHtml = await client.getText(race.url);
  const tabs = parseEventTabs(firstHtml);
  const origin = new URL(race.url).origin;
  const out = [];

  for (const tab of tabs) {
    const eventUrl = `${origin}/results.aspx?CId=${race.customerId}&RId=${race.raceId}&EId=${tab.eventId}&dt=0`;
    // The first page is already fetched when this is the default distance
    let html = tab === tabs[0] ? firstHtml : await client.getText(eventUrl);
    const { total, pages } = parsePaging(html);
    const results = [];
    for (let page = 1; page <= pages; page++) {
      if (page > 1) html = await client.getText(`${eventUrl}&PageNo=${page}`);
      const parsed = parseResultsPage(html, eventUrl);
      if (parsed.skipped) log(`  ${race.name} / ${tab.label}: skipped ${parsed.skipped} unreadable rows on page ${page}`);
      results.push(...parsed.rows);
    }
    if (!results.length) continue;

    const distance = tab.label && tab.label.toLowerCase() !== race.name.toLowerCase() ? tab.label : null;
    out.push({
      event: {
        id: `racetec:${race.customerId}-${race.raceId}-${tab.eventId}`,
        source: 'racetec',
        raceName: race.name,
        distance,
        date: race.date,
        venue: null,
        discipline: guessDiscipline(race.name, distance ?? ''),
        officialUrl: `${origin}/results.aspx?CId=${race.customerId}&RId=${race.raceId}&EId=${tab.eventId}`,
        finishers: total ?? results.length,
      },
      results,
    });
  }
  return out;
}

/**
 * Adapter for the shared runner.
 * @param {string[]} customers  host:CId pairs, e.g. results.runthrough.co.uk:16487
 */
export function racetecAdapter(customers) {
  return {
    id: 'racetec',

    async discover(client, { since, until, log = () => {} }) {
      const races = new Map();
      for (const spec of customers) {
        const [host, cid] = spec.split(':');
        let url = `https://${host}/StartPage.aspx?CId=${cid}`;
        while (url) {
          const html = await client.getText(url);
          const found = parseListing(html, url);
          for (const race of found) races.set(`${new URL(race.url).host}-${race.customerId}-${race.raceId}`, race);
          const oldest = found.map((r) => r.date).filter(Boolean).sort()[0];
          log(`listing ${url}: ${found.length} races, oldest ${oldest ?? 'unknown'}`);
          if (oldest && oldest < since) break;
          url = nextListingUrl(html, url);
        }
      }
      return [...races.values()].filter((r) => r.date && r.date >= since && r.date <= until);
    },

    crawl: (client, race, opts) => crawlRace(client, race, opts),
  };
}
