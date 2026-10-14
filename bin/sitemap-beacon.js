#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, SITE_OPTIONS, SITE_HELP, splitList } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'sitemap-beacon', version: pkg.version, configKey: 'sitemapBeacon', rules: RULES,
  tagline: 'audit XML sitemaps against your built static site',
  usage: 'Usage: sitemap-beacon [site-dir] [options]',
  help: `${SITE_HELP}Checks
      --sitemap <files>        Sitemap file(s) relative to the site dir (default: auto-detect)
      --max-age-days <n>       Report lastmod older than n days (info)
      --not-in-sitemap <globs> Pages that are intentionally not in the sitemap
      --no-coverage            Do not report pages missing from the sitemap
`,
  options: { ...SITE_OPTIONS, sitemap: { type: 'string', multiple: true }, 'max-age-days': { type: 'string' }, 'not-in-sitemap': { type: 'string', multiple: true }, 'no-coverage': { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => {
    const age = o['max-age-days'] != null ? Number(o['max-age-days']) : undefined;
    if (age !== undefined && !(age > 0)) { const { UsageError } = await import('../src/core.js'); throw new UsageError('--max-age-days must be a positive number'); }
    const sm = splitList(o.sitemap);
    return check(dir, { cli: o, sitemaps: sm.length ? sm : undefined, maxAgeDays: age, notInSitemap: splitList(o['not-in-sitemap']), coverage: o['no-coverage'] ? false : undefined, toolVersion: pkg.version }, config, configFile);
  },
});
