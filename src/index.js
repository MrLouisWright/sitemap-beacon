import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { contentPages, runBeacon, finder, SITE_OPTIONS, SITE_HELP, siteOptions, robotsDirectives, isNoindex, canonicalOf, isRedirectStub, isErrorPage, pageDates, matchAny } from './site.js';
import { parseSitemap, readSitemapFile, isW3cDate } from './sitemap.js';
import { buildReport, UsageError } from './core.js';

export * from './core.js';
export { SITE_OPTIONS, SITE_HELP, siteOptions, parseSitemap, isW3cDate };

export const RULES = {
  'sitemap-invalid': { severity: 'high', title: 'Sitemap is not valid XML with a <urlset> or <sitemapindex> root' },
  'sitemap-too-large': { severity: 'high', title: 'Sitemap has more than 50,000 URLs or is larger than 50 MB uncompressed' },
  'sitemap-child-missing': { severity: 'high', title: 'A sitemap index points at a sitemap that is not in the build' },
  'sitemap-loc-invalid': { severity: 'high', title: '<loc> is missing, relative, unescaped or not a valid URL' },
  'sitemap-url-non-200': { severity: 'high', title: 'Sitemap URL has no page in the build, or is a redirect stub or error page' },
  'sitemap-url-noindex': { severity: 'high', title: 'Sitemap URL is noindex (meta robots or X-Robots-Tag)' },
  'sitemap-url-non-canonical': { severity: 'medium', title: 'Sitemap URL canonicalises to a different URL' },
  'sitemap-url-other-host': { severity: 'medium', title: 'Sitemap URL is on another host or protocol than the site' },
  'sitemap-missing': { severity: 'medium', title: 'No XML sitemap found in the build' },
  'sitemap-page-missing': { severity: 'medium', title: 'Indexable, self-canonical page is not in any sitemap' },
  'sitemap-lastmod-invalid': { severity: 'medium', title: 'lastmod is not a W3C datetime (YYYY-MM-DD or YYYY-MM-DDThh:mm:ss+00:00)' },
  'sitemap-lastmod-future': { severity: 'medium', title: 'lastmod is in the future' },
  'sitemap-lastmod-stale': { severity: 'low', title: 'lastmod is older than the modified date on the page itself' },
  'sitemap-lastmod-uniform': { severity: 'low', title: 'Every URL has the same lastmod (usually the build time), so search engines ignore it' },
  'sitemap-url-duplicate': { severity: 'low', title: 'URL is listed more than once' },
  'sitemap-namespace': { severity: 'low', title: 'Missing or wrong sitemap namespace' },
  'sitemap-field-invalid': { severity: 'low', title: 'changefreq / priority has an invalid value' },
  'sitemap-lastmod-old': { severity: 'info', title: 'lastmod is older than maxAgeDays' },
  'sitemap-ignored-fields': { severity: 'info', title: 'changefreq and priority are ignored by Google' },
};
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const FREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
const MAX_URLS = 50000; const MAX_BYTES = 50 * 1024 * 1024;
const day = 86400000;

function discover(site, explicit) {
  if (explicit?.length) return explicit.map((f) => f.replace(/^\/+/, ''));
  const found = site.files.filter((f) => /(^|\/)[^/]*sitemap[^/]*\.xml(\.gz)?$/i.test(f) && !/(^|\/)(node_modules|\.git)\//.test(f));
  const robots = site.read('robots.txt');
  if (robots) for (const m of robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) { try { const p = decodeURIComponent(new URL(m[1], 'http://x.invalid/').pathname).replace(/^\/+/, ''); if (site.exists(p) && !found.includes(p)) found.push(p); } catch { /* ignore */ } }
  // only roots: drop files referenced by an index (they are followed from it)
  return found;
}

export function analyze(site, opts = {}, config = {}) {
  const { findings, add } = finder(RULES);
  const now = opts.now || new Date();
  const maxAge = opts.maxAgeDays ?? config.maxAgeDays ?? null;
  const ignoreMissing = [...(config.notInSitemap || []), ...(opts.notInSitemap || [])];
  const files = discover(site, opts.sitemaps || config.sitemaps);
  if (!files.length) { add('sitemap-missing', 'sitemap.xml', 'No sitemap.xml (or sitemap index) in the build output', 'Generate one with your framework (e.g. @astrojs/sitemap, next-sitemap, eleventy plugin) or pass --sitemap.', {}); return { findings, info: { sitemaps: [] }, summary: `${site.pages.length} page(s); no sitemap` }; }
  const seenFiles = new Set(); const urls = new Map(); const sitemaps = [];
  let origin = site.origin;
  const visit = (rel, via) => {
    if (seenFiles.has(rel)) return; seenFiles.add(rel);
    if (!site.exists(rel)) { add('sitemap-child-missing', rel, `${via ? `${via.file} lists ` : ''}${rel}, which is not in the build`, 'Generate the child sitemap or remove it from the index.', via ? { file: via.file, line: via.line } : {}); return; }
    let r; try { r = readSitemapFile(join(site.dir, rel)); } catch (e) { add('sitemap-invalid', rel, `Cannot read ${rel}: ${e.message}`, 'Regenerate the file.', { file: rel }); return; }
    const sm = parseSitemap(r.xml); sitemaps.push({ file: rel, root: sm.root, urls: sm.entries.length, bytes: r.bytes });
    if (sm.error) add('sitemap-invalid', rel, `${rel}: ${sm.error}`, 'Regenerate the sitemap; it must be <urlset> or <sitemapindex> XML.', { file: rel, line: 1 });
    if (!sm.root) return;
    if (sm.ns !== NS) add('sitemap-namespace', rel, `${rel} ${sm.ns ? `uses namespace ${sm.ns}` : 'has no xmlns'}`, `Use xmlns="${NS}".`, { file: rel, line: 1 });
    if (sm.entries.length > MAX_URLS) add('sitemap-too-large', rel, `${rel} has ${sm.entries.length.toLocaleString('en')} entries (limit 50,000)`, 'Split it and list the parts in a sitemap index.', { file: rel, line: 1 });
    if (r.bytes > MAX_BYTES) add('sitemap-too-large', rel, `${rel} is ${(r.bytes / 1048576).toFixed(1)} MB uncompressed (limit 50 MB)`, 'Split it and list the parts in a sitemap index.', { file: rel, line: 1 });
    if (!origin) for (const e of sm.entries) { try { origin = new URL(e.loc).origin; break; } catch { /* keep looking */ } }
    const lastmods = [];
    let fieldsSeen = false;
    for (const e of sm.entries) {
      const at = { file: rel, line: e.line };
      if (!e.loc) { add('sitemap-loc-invalid', `${rel}:${e.line}`, `<${sm.root === 'urlset' ? 'url' : 'sitemap'}> without <loc>`, 'Every entry needs a <loc>.', at); continue; }
      let u; try { if (!/^https?:\/\//i.test(e.loc)) throw new Error('relative'); u = new URL(e.loc); } catch { add('sitemap-loc-invalid', e.loc, `<loc>${e.loc}</loc> is not an absolute http(s) URL`, `Use the full URL${origin ? `, e.g. ${origin}/${e.loc.replace(/^\/+/, '')}` : ''}.`, at); continue; }
      if (/\s/.test(e.loc) || /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(e.locRaw || '')) add('sitemap-loc-invalid', e.loc, `<loc> contains ${/\s/.test(e.loc) ? 'whitespace' : 'an unescaped &'}`, 'Percent-encode spaces and escape & as &amp;.', at);
      if (e.changefreq != null || e.priority != null) fieldsSeen = true;
      if (e.changefreq != null && !FREQ.has(e.changefreq.toLowerCase())) add('sitemap-field-invalid', e.loc, `changefreq "${e.changefreq}" is not valid`, `Use one of ${[...FREQ].join(', ')} (or drop it; Google ignores it).`, at);
      if (e.priority != null && !(/^(0(\.\d+)?|1(\.0+)?)$/.test(e.priority))) add('sitemap-field-invalid', e.loc, `priority "${e.priority}" is not between 0.0 and 1.0`, 'Use 0.0–1.0 (or drop it; Google ignores it).', at);
      if (e.lastmod != null) {
        if (!isW3cDate(e.lastmod)) add('sitemap-lastmod-invalid', e.loc, `lastmod "${e.lastmod}" is not a W3C datetime`, 'Use YYYY-MM-DD or YYYY-MM-DDThh:mm:ss+00:00.', at);
        else { const lm = new Date(e.lastmod); lastmods.push(e.lastmod); if (lm.getTime() > now.getTime() + day) add('sitemap-lastmod-future', e.loc, `lastmod ${e.lastmod} is in the future`, 'Use the date the content last changed.', at); if (maxAge && now - lm > maxAge * day) add('sitemap-lastmod-old', e.loc, `lastmod ${e.lastmod} is more than ${maxAge} days old`, 'Review or refresh the page.', at); e.lastmodDate = lm; }
      }
      if (sm.root === 'sitemapindex') {
        if (origin && u.origin !== origin) { add('sitemap-url-other-host', e.loc, `Child sitemap ${e.loc} is not on ${origin}`, 'Host child sitemaps on the same host (or verify cross-host submission in Search Console).', at); continue; }
        let cp = decodeURIComponent(u.pathname); if (site.basePath && cp.startsWith(site.basePath)) cp = cp.slice(site.basePath.length); visit(cp.replace(/^\/+/, ''), { file: rel, line: e.line });
        continue;
      }
      const key = u.href.replace(/#.*$/, '');
      if (urls.has(key)) { add('sitemap-url-duplicate', e.loc, `${e.loc} is listed more than once (first in ${urls.get(key).file}:${urls.get(key).line})`, 'List each URL once.', at); continue; }
      urls.set(key, { ...e, file: rel, u });
    }
    if (lastmods.length >= (config.uniformMin ?? 10) && new Set(lastmods).size === 1) add('sitemap-lastmod-uniform', rel, `All ${lastmods.length} URLs in ${rel} have lastmod ${lastmods[0]}`, 'Set lastmod from each page’s real modification date (git or CMS), or omit it.', { file: rel, line: 1 });
    if (fieldsSeen && !(config.ignoredFieldsOk)) add('sitemap-ignored-fields', rel, `${rel} uses changefreq/priority, which Google ignores`, 'Optional: drop them to shrink the file.', { file: rel, line: 1 });
  };
  for (const f of files) visit(f, null);
  // URL checks
  const listedPages = new Set();
  const findPage = (u) => { if (origin && u.origin !== origin) return { other: true }; let p = decodeURIComponent(u.pathname); if (site.basePath && p.startsWith(site.basePath)) p = p.slice(site.basePath.length) || '/'; return { page: site.find(p), path: p }; };
  for (const [, e] of urls) {
    const at = { file: e.file, line: e.line };
    const { other, page, path } = findPage(e.u);
    if (other) { add('sitemap-url-other-host', e.loc, `${e.loc} is not on ${origin}${e.u.hostname === new URL(origin).hostname ? ' (protocol differs)' : ''}`, `Only list URLs on ${origin}.`, at); continue; }
    if (!page) { const rel = path.replace(/^\/+/, ''); if (rel && !rel.endsWith('/') && site.exists(rel) && !/\.html?$/i.test(rel)) continue; add('sitemap-url-non-200', e.loc, `${e.loc} has no page in the build`, 'Remove it from the sitemap, or fix the URL (check trailing slashes and .html; use --clean-urls if your host strips .html).', at); continue; }
    listedPages.add(page);
    if (isRedirectStub(page)) { add('sitemap-url-non-200', e.loc, `${e.loc} is a meta-refresh redirect page (${page.file})`, 'List the destination URL instead.', at); continue; }
    if (isErrorPage(page)) { add('sitemap-url-non-200', e.loc, `${e.loc} is an error page (${page.file})`, 'Remove it from the sitemap.', at); continue; }
    if (isNoindex(robotsDirectives(site, page))) { const src = robotsDirectives(site, page).find((d) => d.directives.includes('noindex') || d.directives.includes('none')); add('sitemap-url-noindex', e.loc, `${e.loc} is noindex (${src.source === 'meta' ? `<meta name="${src.bot}">` : `X-Robots-Tag in ${src.file}`})`, 'Remove noindex pages from the sitemap, or remove the noindex.', at); continue; }
    const c = canonicalOf(site, page).url;
    if (c && c.href.replace(/#.*$/, '') !== e.u.href.replace(/#.*$/, '')) {
      const cu = new URL(c.href); const same = origin ? findPage(cu).page : site.find(cu.pathname);
      if (same !== page || cu.origin !== (origin || cu.origin) || cu.pathname !== e.u.pathname) add('sitemap-url-non-canonical', e.loc, `${e.loc} canonicalises to ${c.href}`, `List ${c.href} in the sitemap instead.`, at);
    }
    if (e.lastmodDate) { const m = pageDates(page.doc).modified; if (m && m.getTime() - e.lastmodDate.getTime() > day) add('sitemap-lastmod-stale', e.loc, `lastmod ${e.lastmod} is older than the page’s own modified date ${m.toISOString().slice(0, 10)}`, 'Regenerate the sitemap from the page’s modified date.', at); }
  }
  // coverage
  if (urls.size && (opts.coverage ?? config.coverage ?? true)) {
    const missing = [];
    for (const pg of contentPages(site)) {
      if (listedPages.has(pg) || matchAny(ignoreMissing, pg.path) || matchAny(ignoreMissing, pg.file)) continue;
      if (isNoindex(robotsDirectives(site, pg))) continue;
      const c = canonicalOf(site, pg).url;
      if (c) { const target = findPage(c); if (target.other || (target.page && target.page !== pg) || (!target.page && origin && c.origin === origin)) continue; }
      missing.push(pg);
    }
    for (const pg of missing.slice(0, config.maxMissing ?? 200)) add('sitemap-page-missing', pg.path, `${origin ? origin + (site.basePath || '') : ''}${pg.path} is indexable but not in the sitemap`, 'Add it to the sitemap, or mark it noindex / canonicalise it if it should not be indexed.', { file: pg.file });
    if (missing.length > (config.maxMissing ?? 200)) add('sitemap-page-missing', '(more)', `…and ${missing.length - (config.maxMissing ?? 200)} more pages`, 'Use --json for the full list.', {});
  }
  return { findings, info: { sitemaps, urls: urls.size }, summary: `${site.pages.length} page(s); ${sitemaps.length} sitemap file(s) with ${urls.size} URL(s)${origin ? ` on ${origin}` : ''}` };
}

export function check(dir, opts = {}, config = {}, configFile) {
  const tool = { name: 'sitemap-beacon', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '🗺️', defaultFile: 'sitemap.xml' };
  return runBeacon(tool, dir, { ...opts, UsageError }, config, configFile, analyze, buildReport);
}
void existsSync;
