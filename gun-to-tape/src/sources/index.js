// Registry of every source. Each adapter has:
//   id                                   short name, also the prefix of its event ids
//   discover(client, {since, until, log})  -> races to crawl, already filtered to the date window
//   crawl(client, race, {log})            -> [{ event, results }]

import { racetecAdapter } from './racetec.js';
import { sportsTimingAdapter } from './sportstiming.js';
import { chipTimingAdapter } from './chiptiming.js';
import { raceTimeResultAdapter } from './racetimeresult.js';
import { feedAdapter } from './feed.js';

export const SOURCES = {
  racetec: (opts) => racetecAdapter(opts.customers),
  sportstiming: () => sportsTimingAdapter(),
  chiptiming: () => chipTimingAdapter(),
  racetimeresult: () => raceTimeResultAdapter(),
  feed: (opts) => feedAdapter(opts),
};

export function buildAdapter(name, opts) {
  const make = SOURCES[name];
  if (!make) throw new Error(`Unknown source "${name}". Available: ${Object.keys(SOURCES).join(', ')}`);
  if (name === 'racetec' && !opts.customers?.length) throw new Error('racetec needs at least one --customer host:CId');
  return make(opts);
}
