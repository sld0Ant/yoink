---
name: yoink
description: Clone/scrape a website with all assets (HTML, CSS, JS, images, fonts) for local offline use. Use when user wants to download, clone, mirror, or scrape a website to run it locally.
---

# yoink

Clone a website with all assets for local offline use.

## Usage

```bash
bun <skill-dir>/clone.ts <url> [output-dir] [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--pages <n>` | Max internal pages (default: 20, 0 = homepage only) |
| `--images <n>` | Max images (default: 200, 0 = unlimited) |
| `--no-cdn` | Skip third-party CDN assets |
| `--concurrency <n>` | Parallel downloads (default: 8) |
| `--cookie, -b <s>` | Cookie header (e.g. `device=desktop` for mobile/desktop switch) |
| `--header, -H <s>` | Extra HTTP header (repeatable) |

### Examples

```bash
bun <skill-dir>/clone.ts https://example.com my-site
bun <skill-dir>/clone.ts https://rb.ru my-site -b "device=desktop"
bun <skill-dir>/clone.ts https://example.com my-site --pages 0 --no-cdn
```

## After cloning

```bash
cd my-site && bun server.ts
```

## What gets downloaded

- HTML, CSS, JS, images, fonts, favicons
- CSS `url()` assets (fonts, background images)
- `srcset`, `<picture>`, OG images

## Limitations

- Static HTML only — no JS rendering (SPAs won't work)
- Single domain only
- No CAPTCHA bypass

## Reference

- [Architecture](references/architecture.md)
