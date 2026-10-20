# Changelog

## 1.0.1 - 2026-10-20

- Docs: README badges, credit and support sections, links to the project site; homepage now points to the project site.
- No changes to the package code.

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Finds sitemaps in the build (`sitemap.xml`, `sitemap_index.xml`, `sitemap-*.xml`, `.xml.gz`, `Sitemap:` lines in robots.txt) and follows sitemap indexes to their children.
- Protocol limits: 50,000 URLs and 50 MB per file, valid root element and namespace, absolute and escaped `<loc>`.
- Every URL is matched to a page in the build: missing pages and meta-refresh stubs, `noindex` (meta robots or `X-Robots-Tag` in `_headers`/`vercel.json`), canonicalised elsewhere, other host or protocol, duplicates.
- `lastmod`: invalid W3C datetime, in the future, older than the page’s own `dateModified`/`article:modified_time`, identical on every URL, optional maximum age.
- Coverage: indexable, self-canonical pages that are not in any sitemap.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
