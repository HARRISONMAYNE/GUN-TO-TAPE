// A polite HTTP client: identifies itself, obeys robots.txt and crawl-delay, never runs requests in parallel.

const DEFAULT_DELAY_MS = 2000;

/** Parse the rules for our user agent (falling back to *) from a robots.txt body. */
export function parseRobots(body, agent = 'guntotapebot') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(body).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow') current.rules.push({ allow: false, path: value });
    else if (key === 'allow') current.rules.push({ allow: true, path: value });
    else if (key === 'crawl-delay') current.crawlDelay = Number(value) || null;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return {
    crawlDelay: chosen.map((g) => g.crawlDelay).find((d) => d != null) ?? null,
    rules: chosen.flatMap((g) => g.rules).filter((r) => r.path !== ''),
  };
}

/** Longest matching rule wins; Allow beats Disallow on a tie. */
export function robotsAllows(robots, path) {
  let best = null;
  for (const rule of robots.rules) {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (!new RegExp(`^${pattern}`).test(path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export class PoliteClient {
  /**
   * @param {object} opts
   * @param {string} opts.contact  Email or URL where site owners can reach you. Required, goes in the User-Agent.
   * @param {number} [opts.delayMs]  Minimum gap between requests to the same host.
   * @param {number} [opts.maxRequests]  Hard cap per run.
   */
  constructor({ contact, delayMs = DEFAULT_DELAY_MS, maxRequests = 2000, fetchImpl = fetch } = {}) {
    if (!contact) throw new Error('SCRAPER_CONTACT is required so site owners can reach you');
    this.userAgent = `GunToTapeBot/0.1 (+${contact})`;
    this.delayMs = delayMs;
    this.maxRequests = maxRequests;
    this.fetch = fetchImpl;
    this.count = 0;
    this.lastByHost = new Map();
    this.robotsByHost = new Map();
  }

  async #wait(host, extraDelayMs) {
    const gap = Math.max(this.delayMs, extraDelayMs ?? 0);
    const last = this.lastByHost.get(host) ?? 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastByHost.set(host, Date.now());
  }

  async #robots(url) {
    const { origin, host } = new URL(url);
    if (this.robotsByHost.has(host)) return this.robotsByHost.get(host);
    await this.#wait(host);
    let robots = { rules: [], crawlDelay: null };
    try {
      const res = await this.fetch(`${origin}/robots.txt`, { headers: { 'user-agent': this.userAgent } });
      if (res.ok) robots = parseRobots(await res.text());
      else if (res.status !== 404) robots = { rules: [{ allow: false, path: '/' }], crawlDelay: null };
    } catch {
      robots = { rules: [{ allow: false, path: '/' }], crawlDelay: null };
    }
    this.robotsByHost.set(host, robots);
    return robots;
  }

  /** Fetch a page as text. Throws if robots.txt forbids it, the run cap is reached, or retries run out. */
  async getText(url, { retries = 3 } = {}) {
    const u = new URL(url);
    const robots = await this.#robots(url);
    if (!robotsAllows(robots, u.pathname + u.search)) throw new Error(`robots.txt disallows ${url}`);
    if (this.count >= this.maxRequests) throw new Error(`request cap of ${this.maxRequests} reached`);

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.#wait(u.host, robots.crawlDelay ? robots.crawlDelay * 1000 : 0);
      this.count++;
      try {
        const res = await this.fetch(url, { headers: { 'user-agent': this.userAgent, accept: 'text/html' } });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
      } catch (err) {
        lastError = err;
        if (String(err.message).startsWith('HTTP 4') && !String(err.message).startsWith('HTTP 429')) break;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 3000));
      }
    }
    throw lastError;
  }
}
