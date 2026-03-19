# yoink

Clone any website with all its assets for local offline use. One command — HTML, CSS, JS, images, fonts.

Inspired by [frvnkfrmchicago/skills-library-v2](https://github.com/frvnkfrmchicago/skills-library-v2) cloning workflow. Rewritten from scratch in TypeScript for Bun.

## Install

```bash
bun install -g yoink-site
```

Or run directly:

```bash
bunx yoink-site https://example.com my-site
```

## Usage

```bash
yoink https://example.com my-site
cd my-site && bun server.ts
# → http://localhost:3000
```

### Options

| Flag | Description |
|------|-------------|
| `--pages <n>` | Max internal pages to follow (default: 20, 0 = homepage only) |
| `--images <n>` | Max images to download (default: 200, 0 = unlimited) |
| `--no-cdn` | Skip third-party CDN assets |
| `--concurrency <n>` | Parallel downloads (default: 8) |
| `--cookie, -b <s>` | Cookie header (e.g. `device=desktop`) |
| `--header, -H <s>` | Extra HTTP header (repeatable) |

### Examples

```bash
# Full site with defaults
yoink https://rb.ru

# Desktop version of a site that defaults to mobile
yoink https://rb.ru my-site -b "device=desktop"

# Homepage only, no CDN assets
yoink https://example.com my-site --pages 0 --no-cdn

# All pages, unlimited images
yoink https://example.com my-site --pages 50 --images 0
```

## What gets downloaded

- HTML pages (homepage + discovered internal links)
- CSS (including assets referenced via `url()` inside them)
- JavaScript
- Images (`<img>`, `srcset`, CSS `background-image`, `<picture>`, OG)
- Fonts (`@font-face` in CSS, including Google Fonts)
- Favicons and icons

## Output

```
my-site/
├── index.html        ← rewritten paths
├── pages/            ← internal pages
├── assets/
│   ├── css/          ← stylesheets (url() paths rewritten too)
│   ├── js/
│   ├── images/
│   └── fonts/
├── server.ts         ← Bun.serve() static server
└── manifest.json     ← download log
```

## Live progress

TTY output with auto-updating status:

```
  Downloading assets   72/120   ━━━━━━━━━━━━━───────────────  60%
  css:1  js:7  img:48  font:12  │  ↓ 3.2 MB  ⏱ 8.4s  ⚡ 390 KB/s
  → ZonaPro-Bold.woff2
```

## MCP Server

yoink ships as an MCP (Model Context Protocol) server for use with Claude, Cursor, and other AI tools.

### Claude Code

```bash
claude mcp add yoink bun /path/to/yoink/mcp.ts
```

### Claude Desktop / Cursor

Add to config:

```json
{
  "mcpServers": {
    "yoink": {
      "command": "bun",
      "args": ["/path/to/yoink/mcp.ts"]
    }
  }
}
```

### Tool: `clone`

Clones a website with all assets. Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `url` | string | URL to clone (required) |
| `outputDir` | string | Output directory (default: "cloned-site") |
| `pages` | number | Max pages (default: 20) |
| `images` | number | Max images (default: 200) |
| `noCdn` | boolean | Skip CDN assets |
| `concurrency` | number | Parallel downloads (default: 8) |
| `cookie` | string | Cookie header |
| `resume` | boolean | Skip already downloaded |
| `inlineScripts` | boolean | Embed JS in HTML |
| `inlineStyles` | boolean | Embed CSS in HTML |

## Limitations

- Static HTML only — no JS rendering (won't work for SPAs)
- Single domain — doesn't follow external links
- No auth/cookies persistence beyond `--cookie` flag

## License

MIT
