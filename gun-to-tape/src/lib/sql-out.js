// Turns scraped events and results into SQL files for `wrangler d1 execute --file`.
// Re-running an import is safe: each event's results are replaced as a set, and every file ends
// by deleting results for athletes who asked to be removed.

import { sql } from './text.js';

const ROWS_PER_INSERT = 50;
const STATEMENTS_PER_FILE = 400;

const REMOVAL_CLEANUP = 'DELETE FROM results WHERE athlete_key IN (SELECT athlete_key FROM removals);';

export function eventStatements({ event, results }, scrapedAt) {
  const out = [];
  out.push(
    `INSERT OR REPLACE INTO events (id, source, race_name, distance, date, venue, discipline, official_url, finishers, scraped_at) VALUES (` +
      [event.id, event.source, event.raceName, event.distance, event.date, event.venue, event.discipline, event.officialUrl, event.finishers, scrapedAt].map(sql).join(', ') +
      ');',
  );
  out.push(`DELETE FROM results WHERE event_id = ${sql(event.id)};`);

  const cols = 'id, event_id, position, status, athlete_name, athlete_key, bib, club, club_key, category, gender, gender_pos, category_pos, gun_ms, chip_ms, time_text, official_url';
  for (let i = 0; i < results.length; i += ROWS_PER_INSERT) {
    const values = results.slice(i, i + ROWS_PER_INSERT).map((r) =>
      '(' + [
        `${event.source}:${r.uid}`, event.id, r.position, r.status, r.name, r.athleteKey, r.bib, r.club, r.clubKey, r.category,
        r.gender, r.genderPos, r.categoryPos, r.gunMs, r.chipMs, r.timeText, r.officialUrl,
      ].map(sql).join(', ') + ')',
    );
    out.push(`INSERT OR REPLACE INTO results (${cols}) VALUES\n${values.join(',\n')};`);
  }
  return out;
}

/** Split statements into files. Every file finishes with the removals cleanup. */
export function buildImportFiles(items, scrapedAt) {
  const files = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    files.push([...current, REMOVAL_CLEANUP].join('\n') + '\n');
    current = [];
  };
  for (const item of items) {
    for (const stmt of eventStatements(item, scrapedAt)) {
      current.push(stmt);
      if (current.length >= STATEMENTS_PER_FILE) flush();
    }
  }
  flush();
  return files;
}
