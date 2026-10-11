// File feed importer. For providers that cannot be scraped but who send an export or feed:
// Stuweb, Race Result, MYLAPS/Sporthive, Resultsbase and anyone else who agrees to supply data.
// Drop CSV or JSON files in a folder and run:
//   node src/run.js feed --provider stuweb --dir feeds/stuweb --since 2026-10-01
//
// One row per finisher. Column names are case-insensitive; see FEEDS.md for the full list.
//   Required: event_name, event_date (yyyy-mm-dd or dd/mm/yyyy), event_url, name (or first_name + last_name), time
//   Optional: distance, venue, discipline (road/xc), position, club, category, gender, bib,
//             gender_position, category_position, status, result_url, result_id

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { athleteKey, formatTime, guessDiscipline, parseDate, parseTimeMs } from '../lib/text.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const intOrNull = (v) => { const n = Number.parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Small RFC 4180 CSV reader: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      // Only treat ; and tab as separators when the file's header line uses them.
      if (c === ',' || src.split('\n', 1)[0].includes(c)) { row.push(field); field = ''; } else field += c;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => clean(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function readFeedFile(path) {
  const text = readFileSync(path, 'utf8');
  if (path.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.results ?? data.rows ?? [];
    return arr.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]+/g, '_'), v])));
  }
  return parseCsv(text);
}

/** Group rows into events and build result records. Rows that cannot be used are counted and skipped. */
export function buildEvents(rows, provider) {
  const groups = new Map();
  let skipped = 0;
  for (const r of rows) {
    const name = clean(r.name) || clean(`${r.first_name ?? ''} ${r.last_name ?? r.surname ?? ''}`);
    const eventName = clean(r.event_name);
    const date = parseDate(clean(r.event_date)) ?? (/^\d{4}-\d{2}-\d{2}$/.test(clean(r.event_date)) ? clean(r.event_date) : null);
    const eventUrl = clean(r.event_url);
    const status = clean(r.status).toLowerCase();
    const gunMs = parseTimeMs(clean(r.time));
    if (!name || !eventName || !date || !/^https?:\/\//.test(eventUrl) || (gunMs == null && !/dnf|dq|dns/.test(status))) { skipped++; continue; }
    const distance = clean(r.distance) || null;
    const key = `${eventName}|${date}|${distance ?? ''}`;
    if (!groups.has(key)) groups.set(key, { eventName, date, distance, venue: clean(r.venue) || null, discipline: clean(r.discipline).toLowerCase(), eventUrl, rows: [] });
    const g = groups.get(key);
    const club = clean(r.club) || null;
    const gender = clean(r.gender).toUpperCase().slice(0, 1);
    const resultUrl = clean(r.result_url);
    g.rows.push({
      uid: `${slug(eventName)}-${date}-${slug(distance ?? '')}-${clean(r.result_id) || clean(r.bib) || g.rows.length + 1}`,
      position: gunMs == null ? null : intOrNull(r.position),
      status: /dq/.test(status) ? 'dq' : /dnf|dns/.test(status) ? 'dnf' : 'finished',
      name,
      athleteKey: athleteKey(name),
      bib: clean(r.bib) || null,
      club,
      clubKey: club ? athleteKey(club) : null,
      category: clean(r.category) || null,
      gender: gender === 'M' || gender === 'F' ? gender : null,
      genderPos: intOrNull(r.gender_position),
      categoryPos: intOrNull(r.category_position),
      gunMs,
      chipMs: null,
      timeText: gunMs == null ? null : formatTime(gunMs),
      officialUrl: /^https?:\/\//.test(resultUrl) ? resultUrl : eventUrl,
    });
  }
  const events = [...groups.values()].map((g) => ({
    event: {
      id: `${provider}:${slug(g.eventName)}-${g.date}${g.distance ? '-' + slug(g.distance) : ''}`,
      source: provider,
      raceName: g.eventName,
      distance: g.distance,
      date: g.date,
      venue: g.venue,
      discipline: g.discipline === 'road' || g.discipline === 'xc' || g.discipline === 'other' ? g.discipline : guessDiscipline(g.eventName, g.distance ?? ''),
      officialUrl: g.eventUrl,
      finishers: g.rows.filter((x) => x.position != null).length,
    },
    results: g.rows,
  }));
  return { events, skipped };
}

export function feedAdapter({ provider, dir }) {
  if (!provider || !/^[a-z0-9-]+$/.test(provider)) throw new Error('feed needs --provider (letters, digits, hyphens), e.g. --provider stuweb');
  if (!dir) throw new Error('feed needs --dir with the CSV or JSON files');
  return {
    id: provider,
    async discover(_client, { log }) {
      const files = readdirSync(dir).filter((f) => /\.(csv|json)$/i.test(f)).sort();
      log(`${files.length} feed files in ${dir}`);
      return files.map((f) => ({ id: f, name: f, url: join(dir, f), date: null }));
    },
    async crawl(_client, race, { log, since, until }) {
      const { events, skipped } = buildEvents(readFeedFile(race.url), provider);
      if (skipped) log(`  ${race.name}: skipped ${skipped} unusable rows`);
      return events.filter((e) => (!since || e.event.date >= since) && (!until || e.event.date <= until));
    },
  };
}
