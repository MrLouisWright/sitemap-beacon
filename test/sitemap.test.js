import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { check, parseSitemap, isW3cDate, RULES } from '../src/index.js';

const fx = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
const bin = new URL('../bin/sitemap-beacon.js', import.meta.url).pathname;
const now = new Date('2026-10-14T12:00:00Z');
const run = (dir, opts = {}, config = {}) => check(dir, { now, ...opts }, config).findings;
const rules = (dir, o, c) => run(dir, o, c).map((f) => f.rule);
function site(files) { const d = mkdtempSync(join(tmpdir(), 'xb-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c); } return d; }
const urlset = (locs) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l[0]}</loc>${l[1] ? `<lastmod>${l[1]}</lastmod>` : ''}</url>`).join('\n')}</urlset>`;
const page = (c) => `<html><head><title>t</title><link rel="canonical" href="${c}"></head><body></body></html>`;

test('good fixture is clean (noindex and 404 pages are not expected in the sitemap)', () => { assert.deepEqual(rules(fx('good')), []); });
test('bad fixture reports every planted problem', () => {
  const r = new Set(rules(fx('bad')));
  for (const x of ['sitemap-child-missing', 'sitemap-loc-invalid', 'sitemap-url-noindex', 'sitemap-url-non-200', 'sitemap-lastmod-invalid', 'sitemap-url-non-canonical', 'sitemap-lastmod-future', 'sitemap-url-other-host', 'sitemap-page-missing', 'sitemap-namespace', 'sitemap-field-invalid', 'sitemap-url-duplicate', 'sitemap-lastmod-stale', 'sitemap-ignored-fields']) assert.ok(r.has(x), x);
});
test('noindex via _headers and via meta are both caught', () => {
  const f = run(fx('bad')).filter((x) => x.rule === 'sitemap-url-noindex').map((x) => x.message);
  assert.ok(f.some((m) => /X-Robots-Tag/.test(m))); assert.ok(f.some((m) => /meta name="robots"/.test(m)));
});
test('no sitemap is reported once', () => { assert.deepEqual(rules(site({ 'index.html': page('https://e.com/') })), ['sitemap-missing']); });
test('uniform lastmod, max age and gzip sitemaps', () => {
  const files = { 'sitemap.xml.gz': gzipSync(urlset(Array.from({ length: 12 }, (_, i) => [`https://e.com/p${i}.html`, '2024-01-01']))) };
  for (let i = 0; i < 12; i++) files[`p${i}.html`] = page(`https://e.com/p${i}.html`);
  const d = site(files);
  const r = rules(d, { maxAgeDays: 365 });
  assert.ok(r.includes('sitemap-lastmod-uniform')); assert.equal(r.filter((x) => x === 'sitemap-lastmod-old').length, 12);
});
test('coverage can be scoped or disabled; robots.txt Sitemap lines are followed', () => {
  const d = site({ 'index.html': page('https://e.com/'), 'extra.html': page('https://e.com/extra.html'), 'maps/main.xml': urlset([['https://e.com/']]), 'robots.txt': 'Sitemap: https://e.com/maps/main.xml\n' });
  assert.deepEqual(rules(d), ['sitemap-page-missing']);
  assert.deepEqual(rules(d, { notInSitemap: ['/extra.html'] }), []);
  assert.deepEqual(rules(d, { coverage: false }), []);
});
test('clean URLs and trailing slashes match pages', () => {
  const d = site({ 'index.html': page('https://e.com/'), 'docs/index.html': page('https://e.com/docs/'), 'about.html': page('https://e.com/about'), 'sitemap.xml': urlset([['https://e.com/'], ['https://e.com/docs/'], ['https://e.com/about']]) });
  assert.deepEqual(rules(d, { cleanUrls: true }), []);
});
test('parseSitemap handles CDATA, entities, comments and extensions', () => {
  const sm = parseSitemap('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><!-- <url><loc>x</loc></url> --><url><loc><![CDATA[https://e.com/a?b=1&c=2]]></loc><image:image><image:loc>https://e.com/i.png</image:loc></image:image></url><url><loc>https://e.com/x?a=1&amp;b=2</loc></url></urlset>');
  assert.deepEqual(sm.entries.map((e) => e.loc), ['https://e.com/a?b=1&c=2', 'https://e.com/x?a=1&b=2']);
  assert.equal(parseSitemap('<html></html>').error, 'root element is not <urlset> or <sitemapindex>');
  assert.ok(isW3cDate('2026-10-14T09:00:00+01:00')); assert.ok(!isW3cDate('2026-10-14 09:00')); assert.ok(!isW3cDate('2026-02-30'));
});
test('CLI: exit codes, SARIF, list-rules, --sitemap, bad option', () => {
  assert.equal(spawnSync(process.execPath, [bin, fx('bad'), '--fail-on', 'high']).status, 1);
  assert.equal(spawnSync(process.execPath, [bin, fx('good'), '--fail-on', 'info']).status, 0);
  assert.equal(spawnSync(process.execPath, [bin, '/nonexistent-dir-xyz']).status, 2);
  assert.equal(spawnSync(process.execPath, [bin, fx('good'), '--max-age-days', 'x']).status, 2);
  assert.equal(spawnSync(process.execPath, [bin, fx('bad'), '--sitemap', 'nope.xml', '--fail-on', 'high']).status, 1);
  const s = JSON.parse(execFileSync(process.execPath, [bin, fx('bad'), '-f', 'sarif', '--fail-on', 'none'], { encoding: 'utf8' }));
  assert.equal(s.version, '2.1.0'); assert.ok(s.runs[0].results.length > 15);
  const l = execFileSync(process.execPath, [bin, '--list-rules'], { encoding: 'utf8' }); for (const k of Object.keys(RULES)) assert.ok(l.includes(k));
});
