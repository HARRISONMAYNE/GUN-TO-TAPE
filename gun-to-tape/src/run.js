#!/usr/bin/env node
// Usage:
//   SCRAPER_CONTACT=you@example.com node src/run.js <source> [options]
//
//   node src/run.js racetec --customer www.racetecresults.com:16418 --customer results.runthrough.co.uk:16487
//   node src/run.js sportstiming --since 2026-10-01
//
// Options: --since YYYY-MM-DD (default 14 days ago)  --until YYYY-MM-DD (default today)
//          --out DIR (default out)  --delay MS (default 2000)  --max-requests N (default 2000)
// Writes DIR/<source>/import-0001.sql ... and DIR/<source>/summary.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { PoliteClient } from './lib/http.js';
import { buildImportFiles } from './lib/sql-out.js';
import { buildAdapter } from './sources/index.js';

function parseArgs(argv) {
  const args = { customers: [], since: null, until: null, out: 'out', delay: 2000, maxRequests: 2000, provider: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--customer') args.customers.push(argv[++i]);
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--until') args.until = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--delay') args.delay = Number(argv[++i]);
    else if (a === '--provider') args.provider = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--max-requests') args.maxRequests = Number(argv[++i]);
    else throw new Error(`Unknown argument ${a}`);
  }
  return args;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

async function main() {
  const [source, ...rest] = process.argv.slice(2);
  if (!source) throw new Error('Usage: node src/run.js <source> [options]');
  const args = parseArgs(rest);
  const adapter = buildAdapter(source, args);

  const since = args.since ?? isoDay(new Date(Date.now() - 14 * 86400000));
  const until = args.until ?? isoDay(new Date());
  const client = new PoliteClient({ contact: process.env.SCRAPER_CONTACT ?? (source === 'feed' ? 'local-feed' : undefined), delayMs: args.delay, maxRequests: args.maxRequests });
  const log = (msg) => console.log(msg);

  const races = await adapter.discover(client, { since, until, log });
  log(`${races.length} races between ${since} and ${until}`);

  const items = [];
  const failures = [];
  for (const race of races) {
    try {
      const records = await adapter.crawl(client, race, { log, since, until });
      items.push(...records);
      const n = records.reduce((sum, r) => sum + r.results.length, 0);
      log(`ok  ${race.date} ${race.name}: ${records.length} events, ${n} results`);
    } catch (err) {
      failures.push({ race: race.name, url: race.url, error: String(err.message) });
      log(`FAIL ${race.name}: ${err.message}`);
      if (/request cap/.test(err.message)) break;
    }
  }

  const dir = `${args.out}/${args.provider ?? source}`;
  mkdirSync(dir, { recursive: true });
  const files = buildImportFiles(items, new Date().toISOString());
  files.forEach((body, i) => writeFileSync(`${dir}/import-${String(i + 1).padStart(4, '0')}.sql`, body));
  const summary = { source: args.provider ?? source, since, until, races: races.length, events: items.length, results: items.reduce((s, r) => s + r.results.length, 0), requests: client.count, failures };
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary));

  if (failures.length && !items.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exit(1); });
