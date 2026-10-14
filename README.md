# sitemap-beacon

> Audit XML sitemaps against your built static site: every URL should be a real, indexable, canonical page, and every such page should be listed.

Sitemaps drift away from the site they describe. A page gets `noindex` but stays in the sitemap. A post is canonicalised to its new URL, but the old one is still listed. The build stamps every `lastmod` with the deploy time, so Google stops trusting the dates. A section is added and never makes it into the sitemap. `sitemap-beacon` reads your sitemaps (indexes, children and `.xml.gz`) alongside the built HTML and checks each one against the other. It reports the file, line, severity and a **concrete fix**, before you deploy.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**. Works on any static build output (Astro, Next.js `output: 'export'`, Eleventy, Hugo, Jekyll, Docusaurus, VitePress, plain HTML) and runs offline: point it at the folder your build writes. By Louis Wright.

## Features

- **Discovery:** `sitemap.xml`, `sitemap_index.xml`, `sitemap-*.xml`, `.xml.gz`, and the files named in `Sitemap:` lines in robots.txt. Sitemap indexes are followed to their children, and missing children are reported.
- **Protocol:** valid `<urlset>`/`<sitemapindex>` root and namespace, 50,000-URL and 50 MB limits, absolute and properly escaped `<loc>`, duplicates, and valid `changefreq`/`priority` (which Google ignores; reported as info).
- **Each URL vs the build:** no page at that URL (or only a meta-refresh stub or an error page), `noindex` from meta robots or from `X-Robots-Tag` in `_headers`/`vercel.json`, canonicalised to a different URL, or another host or protocol.
- **lastmod:** invalid W3C datetime, in the future, older than the page's own `dateModified`/`article:modified_time`, the same on every URL (a build timestamp), and an optional maximum age.
- **Coverage:** indexable, self-canonical pages that are not in any sitemap. Use `notInSitemap` globs for pages you leave out on purpose.
- **Output:** text, JSON, SARIF 2.1.0 and Markdown; `--fail-on`; exit codes 0/1/2; allowlist entries with expiry dates.

`sitemap-beacon` doesn't follow links, check robots.txt rules or test redirects. For those, see static-link-sentinel, securitytxt-sentinel and redirect-sentinel.

## Rules

| Rule | Default severity | What it catches |
|---|---|---|
| `sitemap-invalid` | high | Sitemap is not valid XML with a <urlset> or <sitemapindex> root |
| `sitemap-too-large` | high | Sitemap has more than 50,000 URLs or is larger than 50 MB uncompressed |
| `sitemap-child-missing` | high | A sitemap index points at a sitemap that is not in the build |
| `sitemap-loc-invalid` | high | <loc> is missing, relative, unescaped or not a valid URL |
| `sitemap-url-non-200` | high | Sitemap URL has no page in the build, or is a redirect stub or error page |
| `sitemap-url-noindex` | high | Sitemap URL is noindex (meta robots or X-Robots-Tag) |
| `sitemap-url-non-canonical` | medium | Sitemap URL canonicalises to a different URL |
| `sitemap-url-other-host` | medium | Sitemap URL is on another host or protocol than the site |
| `sitemap-missing` | medium | No XML sitemap found in the build |
| `sitemap-page-missing` | medium | Indexable, self-canonical page is not in any sitemap |
| `sitemap-lastmod-invalid` | medium | lastmod is not a W3C datetime (YYYY-MM-DD or YYYY-MM-DDThh:mm:ss+00:00) |
| `sitemap-lastmod-future` | medium | lastmod is in the future |
| `sitemap-lastmod-stale` | low | lastmod is older than the modified date on the page itself |
| `sitemap-lastmod-uniform` | low | Every URL has the same lastmod (usually the build time), so search engines ignore it |
| `sitemap-url-duplicate` | low | URL is listed more than once |
| `sitemap-namespace` | low | Missing or wrong sitemap namespace |
| `sitemap-field-invalid` | low | changefreq / priority has an invalid value |
| `sitemap-lastmod-old` | info | lastmod is older than maxAgeDays |
| `sitemap-ignored-fields` | info | changefreq and priority are ignored by Google |
| `allowlist-expired` | medium | Allowlist entry has expired |
| `allowlist-unused` | info | Allowlist entry matched nothing |

## Install and run

```bash
npx sitemap-beacon dist
npx sitemap-beacon dist --base-url https://example.com --fail-on medium
npx sitemap-beacon public --sitemap sitemap-index.xml --max-age-days 730
npx sitemap-beacon out --clean-urls --not-in-sitemap "/tags/**,/page/*"
```

Pages are mapped to URLs the way static hosts serve them: `index.html` → `/`, `blog/index.html` → `/blog/`, `about.html` → `/about.html` (or `/about` with `--clean-urls`). Pass `--base-url` with your public URL, or let it be inferred from canonical / `og:url` tags. Pages with a meta refresh (redirect stubs) and `404.html` are skipped.

### Sample output

```text
sitemap-beacon — https://example.com
8 page(s); 2 sitemap file(s) with 10 URL(s) on https://example.com

HIGH     sitemap_index.xml:4 sitemap_index.xml lists sitemap-posts.xml, which is not in the build [sitemap-child-missing]
         ↳ fix: Generate the child sitemap or remove it from the index.
HIGH     sitemap-pages.xml:6 <loc>/blog/copy.html</loc> is not an absolute http(s) URL [sitemap-loc-invalid]
         ↳ fix: Use the full URL, e.g. https://example.com/blog/copy.html.
HIGH     sitemap-pages.xml:9 https://example.com/private/secret.html is noindex (X-Robots-Tag in _headers) [sitemap-url-noindex]
         ↳ fix: Remove noindex pages from the sitemap, or remove the noindex.
HIGH     sitemap-pages.xml:10 https://example.com/tag.html is noindex (<meta name="robots">) [sitemap-url-noindex]
         ↳ fix: Remove noindex pages from the sitemap, or remove the noindex.
HIGH     sitemap-pages.xml:11 https://example.com/old.html is a meta-refresh redirect page (old.html) [sitemap-url-non-200]
         ↳ fix: List the destination URL instead.
HIGH     sitemap-pages.xml:12 https://example.com/gone.html has no page in the build [sitemap-url-non-200]
         ↳ fix: Remove it from the sitemap, or fix the URL (check trailing slashes and .html; use --clean-urls if your host strips .html).
HIGH     sitemap-pages.xml:14 <loc> contains an unescaped & [sitemap-loc-invalid]
         ↳ fix: Percent-encode spaces and escape & as &amp;.
HIGH     sitemap-pages.xml:14 https://example.com/search?q=a&b=c has no page in the build [sitemap-url-non-200]
…

8 high, 5 medium, 5 low, 1 info
✔ Passing (fail-on: none).
```

## Options

```text
sitemap-beacon 1.0.0 — audit XML sitemaps against your built static site

Usage: sitemap-beacon [site-dir] [options]

Site
      --base-url <url>        Public URL of the site, e.g. https://example.com (default: inferred from canonical/og:url)
      --include <globs>       Only check these pages (file or URL path globs, comma-separated)
      --exclude <globs>       Skip these pages
      --clean-urls            Pages are served without .html (about.html -> /about)
Checks
      --sitemap <files>        Sitemap file(s) relative to the site dir (default: auto-detect)
      --max-age-days <n>       Report lastmod older than n days (info)
      --not-in-sitemap <globs> Pages that are intentionally not in the sitemap
      --no-coverage            Do not report pages missing from the sitemap

Common
  -c, --config <file>     JSON config (default: .sitemap-beacon.json or "sitemapBeacon" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.sitemap-beacon.json` (or a `"sitemapBeacon"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": { "sitemap-lastmod-uniform": "low" },
  "allowlist": [
    { "rule": "sitemap-page-missing", "subject": "/tags/*", "reason": "Tag pages are deliberately left out of the sitemap", "expires": "2027-03-31" }
  ],
  "maxAgeDays": 730
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

Config can also set `baseUrl`, `include`, `exclude` and `cleanUrls`. The config file is looked up in the site directory first, then in the current directory, so `.sitemap-beacon.json` can live at your repository root. Other keys: `sitemaps`, `maxAgeDays`, `notInSitemap`, `"coverage": false`, `uniformMin` (default 10) and `"ignoredFieldsOk": true`.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  sitemap-beacon:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - run: npm ci && npm run build   # produce the static site first
      - uses: MrLouisWright/sitemap-beacon@v1
        with:
          path: dist
          fail-on: high
          sarif: sitemap-beacon.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: sitemap-beacon.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Built site directory (e.g. dist, public, _site) | `.` |
| `base-url` | Public URL of the site, e.g. https://example.com | `` |
| `sitemap` | Sitemap file(s) relative to the site directory (comma-separated; default: auto-detect) | `` |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, parseSitemap } from 'sitemap-beacon';
const report = check('dist', { maxAgeDays: 365 });
console.log(report.info.sitemaps, report.info.urls);
parseSitemap(xml).entries; // [{ loc, lastmod, changefreq, priority, line }]
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Support

If this project is useful to you, you can support its development with a donation: [Buy me a coffee](https://donate.stripe.com/aFa00lek3cvX4Ds2Fk9EI0b). It helps keep these tools maintained, documented and free for everyone.

## Licence

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))
