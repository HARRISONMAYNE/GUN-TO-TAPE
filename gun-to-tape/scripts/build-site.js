// Wraps site/page.html in a full document for Cloudflare Pages (public/index.html).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const page = readFileSync(new URL('../site/page.html', import.meta.url), 'utf8');
const doc = `<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="color-scheme" content="light dark">\n<meta name="description" content="Search UK road and cross country results by athlete, event or club, with a link to every organiser's official results.">\n${page}\n</html>\n`
  .replace('<title>', '<title>').replace(/<\/script>\s*\n<\/html>/, '</script>\n</body>\n</html>')
  .replace(/(<\/style>)\s*\n/, '$1\n</head>\n<body>\n');
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/index.html', import.meta.url), doc);
console.log('wrote public/index.html', doc.length, 'bytes');
