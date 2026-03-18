# Architecture

## Runtime

Bun-native throughout:
- `fetch()` for all HTTP requests (text and binary)
- `Bun.write(path, response)` streams binary responses directly to disk
- `Bun.file(path).text()` for reading files
- `Bun.serve()` in the generated static server
- `node:fs` only for `mkdirSync` / `readdirSync` (no Bun equivalent)

## Download Pipeline

```
1. Fetch homepage HTML
   ├── Extract <link rel="stylesheet"> → download CSS
   │   └── Parse each CSS file for url() references
   │       ├── @font-face src → download fonts
   │       ├── background-image → download images
   │       └── @import → download + recurse (max depth 5)
   ├── Extract <script src> → download JS
   ├── Extract <img src>, <img srcset> → download images
   ├── Extract <picture><source> → download images
   ├── Extract <link rel="icon/apple-touch-icon"> → download favicons
   ├── Extract <meta og:image> → download OG images
   └── Extract <a href> (same domain) → queue internal pages
       └── For each page: repeat asset extraction

2. Rewrite all paths
   ├── HTML: rewrite src, href, srcset, style attributes
   ├── CSS: rewrite url() references relative to CSS file location
   └── Generate relative paths based on file depth

3. Generate server.ts + manifest.json
```

## Path Rewriting

All absolute URLs and domain-relative paths are converted to relative local paths.

Example: `https://example.com/static/style.css` → `assets/css/style.css`

CSS files get special treatment — `url()` references inside them are rewritten
relative to the CSS file's location (e.g., `url(../fonts/roboto.woff2)`).

Replacements are sorted longest-URL-first to avoid partial matches.

## Deduplication

Assets are tracked by resolved URL. If the same image is referenced by
multiple pages, it's downloaded once. Filename collisions get a numeric
suffix (`logo-1.png`, `logo-2.png`).

## Concurrency

Downloads run with bounded concurrency (default: 8) via a simple worker pool.
Each worker pulls the next task from a shared index. No external deps.

## CDN Handling

By default, CDN-hosted assets ARE downloaded (Google Fonts CSS, font files, etc.)
for a fully offline copy. `--no-cdn` skips them.

Google Fonts: CSS is fetched with a Chrome User-Agent to get woff2 format,
then font files referenced inside are downloaded.

## User-Agent

Requests use a Chrome 131 User-Agent to avoid blocks and to ensure
Google Fonts serves woff2.

## Error Handling

Failed downloads are logged to `manifest.json` with `"status": "failed"` but
don't stop the process. Summary at the end shows counts.

## Limitations

- **No JS rendering** — static HTML only. SPAs render empty shells.
- **No auth** — sites behind login won't work. Use `agent-browser` for those.
- **@import depth** — CSS imports followed up to 5 levels to prevent loops.
