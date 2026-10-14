import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decode } from './site.js';

/** Parse sitemap XML. Returns { root, ns, entries: [{ loc, lastmod, changefreq, priority, line }], error, bytes }. */
export function parseSitemap(xml) {
  const out = { root: null, ns: null, entries: [], error: null };
  const text = String(xml).replace(/^\uFEFF/, '');
  const body = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const rm = /<([a-zA-Z_][\w.-]*:)?(urlset|sitemapindex)\b([^>]*)>/.exec(body);
  if (!rm) { out.error = /<\?xml/.test(body) || /<\w/.test(body) ? 'root element is not <urlset> or <sitemapindex>' : 'not XML'; return out; }
  out.root = rm[2]; out.ns = /xmlns(?::\w+)?\s*=\s*["']([^"']+)["']/.exec(rm[3])?.[1] ?? null;
  if (!new RegExp(`</(${rm[1] || ''})?${rm[2]}\\s*>`).test(body)) out.error = `<${rm[2]}> is not closed`;
  const tag = out.root === 'urlset' ? 'url' : 'sitemap';
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}\\s*>`, 'g');
  const lineAt = (i) => { let n = 1; for (let k = 0; k < i; k++) if (body.charCodeAt(k) === 10) n++; return n; };
  let lastIdx = 0; let line = 1;
  for (const m of body.matchAll(re)) {
    for (let k = lastIdx; k < m.index; k++) if (body.charCodeAt(k) === 10) line++; lastIdx = m.index;
    const field = (f) => { const x = new RegExp(`<(?:[\\w.-]+:)?${f}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${f}\\s*>`).exec(m[1].replace(/<(?:image|video|news|xhtml):[\s\S]*?(?:\/>|<\/(?:image|video|news|xhtml):\w+>)/g, '')); if (!x) return null; const raw = x[1].trim(); const cd = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw); return { value: cd ? cd[1].trim() : decode(raw), raw }; };
    const loc = field('loc');
    out.entries.push({ loc: loc?.value ?? null, locRaw: loc?.raw ?? null, lastmod: field('lastmod')?.value ?? null, changefreq: field('changefreq')?.value ?? null, priority: field('priority')?.value ?? null, line });
  }
  void lineAt;
  return out;
}
export function readSitemapFile(file) {
  let buf = readFileSync(file); const packed = statSync(file).size;
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return { xml: buf.toString('utf8'), bytes: buf.length, packed };
}
/** W3C Datetime (the sitemap lastmod format). */
export function isW3cDate(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/.exec(String(s).trim());
  if (!m) return false;
  const [, y, mo, d] = m.map((x) => (x == null ? x : +x));
  if (mo != null && (mo < 1 || mo > 12)) return false;
  if (d != null && (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate())) return false;
  return true;
}
