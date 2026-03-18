#!/usr/bin/env bun

import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve, basename, extname, relative, dirname } from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CDN_PATTERNS = [
  "cdn.",
  "cdnjs.cloudflare.com",
  "jsdelivr.net",
  "unpkg.com",
  "bootstrapcdn.com",
  "fontawesome.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ajax.googleapis.com",
  "code.jquery.com",
];

interface DownloadRecord {
  local: string;
  status: "ok" | "failed" | "pending";
}

interface Assets {
  css: string[];
  js: string[];
  images: string[];
  fonts: string[];
  icons: string[];
}

interface CloneOpts {
  pages?: number;
  images?: number;
  noCdn?: boolean;
  concurrency?: number;
  cookie?: string;
  headers?: Record<string, string>;
}

// ── Live progress display ──────────────────────────────────

const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";
const UP = "\x1b[A";

class Progress {
  phase = "";
  currentFile = "";
  total = 0;
  done = 0;
  failed = 0;
  bytes = 0;
  counts = { css: 0, js: 0, img: 0, font: 0, icon: 0, page: 0 };

  private t0 = performance.now();
  private lines = 0;
  private timer: Timer | null = null;
  private isTTY = process.stdout.isTTY ?? false;

  start() {
    if (!this.isTTY) return;
    process.stdout.write(HIDE_CURSOR);
    this.timer = setInterval(() => this.render(), 120);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.clear();
    if (this.isTTY) process.stdout.write(SHOW_CURSOR);
  }

  setPhase(name: string) {
    this.phase = name;
    if (!this.isTTY) process.stdout.write(`  ${name}\n`);
  }

  tick(type: keyof typeof this.counts, file: string, fileBytes = 0) {
    this.done++;
    this.counts[type]++;
    this.bytes += fileBytes;
    this.currentFile = file;
    if (!this.isTTY) process.stdout.write(`  ${GRAY}${type}:${RESET} ${file}\n`);
  }

  tickFail() {
    this.done++;
    this.failed++;
  }

  addTotal(n: number) {
    this.total += n;
  }

  private clear() {
    if (!this.isTTY) return;
    for (let i = 0; i < this.lines; i++) {
      process.stdout.write(`${UP}${CLEAR_LINE}`);
    }
    this.lines = 0;
  }

  private render() {
    this.clear();
    const cols = process.stdout.columns ?? 80;
    const elapsed = (performance.now() - this.t0) / 1000;
    const pct = this.total > 0 ? Math.round((this.done / this.total) * 100) : 0;

    const barW = Math.min(30, cols - 40);
    const filled = this.total > 0 ? Math.round((this.done / this.total) * barW) : 0;
    const bar = "━".repeat(filled) + "─".repeat(barW - filled);
    const barColor = pct === 100 ? GREEN : CYAN;

    const line1 =
      `  ${BOLD}${this.phase}${RESET}   ${this.done}/${this.total}   ` +
      `${barColor}${bar}${RESET}  ${BOLD}${pct}%${RESET}`;

    const { css, js, img, font, icon, page } = this.counts;
    const parts: string[] = [];
    if (css) parts.push(`css:${css}`);
    if (js) parts.push(`js:${js}`);
    if (img) parts.push(`img:${img}`);
    if (font) parts.push(`font:${font}`);
    if (icon) parts.push(`icon:${icon}`);
    if (page) parts.push(`page:${page}`);
    if (this.failed) parts.push(`${RED}✗ ${this.failed}${RESET}`);

    const speed = elapsed > 0 ? this.bytes / elapsed : 0;
    const sizeStr = this.bytes < 1024 * 1024
      ? `${(this.bytes / 1024).toFixed(0)} KB`
      : `${(this.bytes / 1024 / 1024).toFixed(1)} MB`;
    const speedStr = speed < 1024 * 1024
      ? `${(speed / 1024).toFixed(0)} KB/s`
      : `${(speed / 1024 / 1024).toFixed(1)} MB/s`;

    const line2 =
      `  ${GRAY}${parts.join("  ")}  │  ↓ ${sizeStr}  ⏱ ${elapsed.toFixed(1)}s  ⚡ ${speedStr}${RESET}`;

    const name = this.currentFile.length > cols - 6
      ? "…" + this.currentFile.slice(-(cols - 7))
      : this.currentFile;
    const line3 = `  ${YELLOW}→${RESET} ${GRAY}${name}${RESET}`;

    const output = [line1, line2, line3];
    for (const l of output) {
      process.stdout.write(l + "\n");
    }
    this.lines = output.length;
  }
}

// ── Cloner ─────────────────────────────────────────────────

class Cloner {
  private target: URL;
  private origin: string;
  private outDir: string;
  private maxPages: number;
  private maxImages: number;
  private skipCdn: boolean;
  private concurrency: number;
  private extraHeaders: Record<string, string>;
  private progress = new Progress();

  private downloaded = new Map<string, DownloadRecord>();
  private failed: string[] = [];
  private assetMap = new Map<string, string>();
  private nameCounters = new Map<string, number>();
  private imgCount = 0;

  constructor(targetUrl: string, outDir: string, opts: CloneOpts = {}) {
    this.target = new URL(targetUrl);
    this.origin = this.target.origin;
    this.outDir = resolve(outDir);
    this.maxPages = opts.pages ?? 20;
    this.maxImages = opts.images ?? 200;
    this.skipCdn = opts.noCdn ?? false;
    this.concurrency = opts.concurrency ?? 8;

    this.extraHeaders = { ...opts.headers };
    if (opts.cookie) this.extraHeaders["Cookie"] = opts.cookie;
  }

  async run() {
    const t0 = performance.now();
    console.log(`\n  ${BOLD}${this.target.hostname}${RESET} → ${CYAN}${basename(this.outDir)}${RESET}\n`);

    this.progress.start();

    for (const d of ["", "assets/css", "assets/js", "assets/images", "assets/fonts", "pages"]) {
      mkdirSync(join(this.outDir, d), { recursive: true });
    }

    this.progress.setPhase("Fetching homepage");
    const homeHtml = await this.getText(this.target.href);
    if (!homeHtml) {
      this.progress.stop();
      console.error(`\n  ${RED}Failed to fetch homepage${RESET}`);
      process.exit(1);
    }

    this.progress.setPhase("Downloading assets");
    await this.downloadAssets(this.extractAssets(homeHtml, this.target.href));

    if (this.maxPages > 0) {
      const allLinks = this.extractInternalLinks(homeHtml, this.target.href);
      const pages = allLinks.slice(0, this.maxPages);

      if (pages.length > 0) {
        this.progress.setPhase("Downloading pages");
        this.progress.addTotal(pages.length);

        for (const pageUrl of pages) {
          const html = await this.getText(pageUrl);
          if (!html) {
            this.progress.tickFail();
            continue;
          }

          const slug = this.pageSlug(pageUrl);
          await Bun.write(join(this.outDir, "pages", slug), html);
          this.assetMap.set(pageUrl, `pages/${slug}`);
          this.record(pageUrl, `pages/${slug}`, "ok");
          this.progress.tick("page", slug, html.length);

          const pageAssets = this.extractAssets(html, pageUrl);
          await this.downloadAssets(pageAssets);
        }
      }
    }

    this.progress.setPhase("Rewriting paths");

    const rewrittenHome = this.rewriteHtml(homeHtml, this.target.href, 0);
    await Bun.write(join(this.outDir, "index.html"), rewrittenHome);

    const pagesDir = join(this.outDir, "pages");
    for (const file of this.listDir(pagesDir)) {
      if (!file.endsWith(".html")) continue;
      const raw = await Bun.file(join(pagesDir, file)).text();
      const pageUrl = this.findUrlByLocal(`pages/${file}`);
      const rewritten = this.rewriteHtml(raw, pageUrl ?? this.target.href, 1);
      await Bun.write(join(pagesDir, file), rewritten);
    }

    await this.rewriteAllCss();
    await this.writeServerFile();
    await this.writeManifest();

    this.progress.stop();

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const okCount = [...this.downloaded.values()].filter((d) => d.status === "ok").length;
    const failCount = this.failed.length;

    console.log(`  ${GREEN}✓${RESET} ${BOLD}Done${RESET} in ${elapsed}s — ${GREEN}${okCount} downloaded${RESET}${failCount ? `, ${RED}${failCount} failed${RESET}` : ""}`);
    console.log(`  ${GRAY}Run:${RESET}  cd ${basename(this.outDir)} && bun server.ts`);
    console.log(`  ${GRAY}Open:${RESET} ${CYAN}http://localhost:3000${RESET}\n`);
  }

  // ── Extract ──────────────────────────────────────────────

  private extractAssets(html: string, baseUrl: string): Assets {
    const a: Assets = { css: [], js: [], images: [], fonts: [], icons: [] };

    for (const m of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi))
      a.css.push(this.abs(m[1], baseUrl));
    for (const m of html.matchAll(/<link[^>]*href=["']([^"']+\.css[^"']*)["'][^>]*rel=["']stylesheet["'][^>]*>/gi))
      a.css.push(this.abs(m[1], baseUrl));

    for (const m of html.matchAll(/<link[^>]*rel=["'][^"']*(?:icon|apple-touch-icon|shortcut)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi))
      a.icons.push(this.abs(m[1], baseUrl));
    for (const m of html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:icon|apple-touch-icon|shortcut)[^"']*["'][^>]*>/gi))
      a.icons.push(this.abs(m[1], baseUrl));

    for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi))
      a.js.push(this.abs(m[1], baseUrl));

    for (const m of html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi))
      if (!m[1].startsWith("data:")) a.images.push(this.abs(m[1], baseUrl));

    for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi))
      for (const entry of m[1].split(",")) {
        const src = entry.trim().split(/\s+/)[0];
        if (src && !src.startsWith("data:")) a.images.push(this.abs(src, baseUrl));
      }

    for (const m of html.matchAll(/<source[^>]*srcset=["']([^"']+)["'][^>]*>/gi))
      for (const entry of m[1].split(",")) {
        const src = entry.trim().split(/\s+/)[0];
        if (src && !src.startsWith("data:")) a.images.push(this.abs(src, baseUrl));
      }

    for (const m of html.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/gi))
      if (!m[1].startsWith("data:")) a.images.push(this.abs(m[1], baseUrl));
    for (const m of html.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi))
      if (!m[1].startsWith("data:")) a.images.push(this.abs(m[1], baseUrl));

    for (const m of html.matchAll(/url\(\s*['"]?([^'"()\s]+)['"]?\s*\)/gi)) {
      const u = m[1];
      if (u.startsWith("data:") || u.startsWith("#")) continue;
      const resolved = this.abs(u, baseUrl);
      if (this.isFont(u)) a.fonts.push(resolved);
      else a.images.push(resolved);
    }

    return this.dedup(a);
  }

  private extractCssAssets(css: string, cssUrl: string) {
    const a: { css: string[]; fonts: string[]; images: string[] } = { css: [], fonts: [], images: [] };

    for (const m of css.matchAll(/@import\s+url\(\s*['"]?([^'"()\s]+)['"]?\s*\)/gi))
      a.css.push(this.abs(m[1], cssUrl));
    for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi))
      a.css.push(this.abs(m[1], cssUrl));

    for (const m of css.matchAll(/url\(\s*['"]?([^'"()\s]+)['"]?\s*\)/gi)) {
      const u = m[1];
      if (u.startsWith("data:") || u.startsWith("#")) continue;
      const resolved = this.abs(u, cssUrl);
      if (this.isFont(u)) a.fonts.push(resolved);
      else a.images.push(resolved);
    }

    return {
      css: [...new Set(a.css)],
      fonts: [...new Set(a.fonts)],
      images: [...new Set(a.images)],
    };
  }

  private extractInternalLinks(html: string, baseUrl: string) {
    const seen = new Set<string>();
    const links: string[] = [];
    const homeNorm = this.target.origin + this.target.pathname;

    for (const m of html.matchAll(/<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
      const href = m[1];
      if (/^(?:mailto:|tel:|javascript:)/.test(href)) continue;

      let resolved: URL;
      try {
        resolved = new URL(href, baseUrl);
      } catch {
        continue;
      }
      if (resolved.origin !== this.origin) continue;
      if (/\.(pdf|zip|doc|docx|xls|xlsx|png|jpg|gif|svg|mp4)$/i.test(resolved.pathname)) continue;

      const norm = resolved.origin + resolved.pathname;
      if (seen.has(norm) || norm === homeNorm) continue;
      seen.add(norm);
      links.push(norm);
    }
    return links;
  }

  // ── Download ─────────────────────────────────────────────

  private async downloadAssets(assets: Assets) {
    const tasks: { type: keyof Progress["counts"]; url: string; rel: string }[] = [];

    for (const url of assets.css) {
      if (this.downloaded.has(url) || (this.skipCdn && this.isCdn(url))) continue;
      const rel = this.allocName(url, "assets/css");
      tasks.push({ type: "css", url, rel });
    }

    for (const url of assets.js) {
      if (this.downloaded.has(url) || (this.skipCdn && this.isCdn(url))) continue;
      const rel = this.allocName(url, "assets/js");
      tasks.push({ type: "js", url, rel });
    }

    for (const url of assets.images) {
      if (this.downloaded.has(url)) continue;
      if (this.maxImages > 0 && this.imgCount >= this.maxImages) continue;
      if (this.skipCdn && this.isCdn(url)) continue;
      this.imgCount++;
      const rel = this.allocName(url, "assets/images");
      tasks.push({ type: "img", url, rel });
    }

    for (const url of assets.fonts) {
      if (this.downloaded.has(url) || (this.skipCdn && this.isCdn(url))) continue;
      const rel = this.allocName(url, "assets/fonts");
      tasks.push({ type: "font", url, rel });
    }

    for (const url of assets.icons) {
      if (this.downloaded.has(url)) continue;
      const rel = this.allocName(url, "assets/images");
      tasks.push({ type: "icon", url, rel });
    }

    this.progress.addTotal(tasks.length);

    const work = tasks.map((t) => async () => {
      if (t.type === "css") {
        await this.downloadCss(t.url, t.rel);
      } else {
        await this.downloadBin(t.url, t.rel, t.type);
      }
    });

    await this.parallel(work);
  }

  private async downloadCss(url: string, rel: string, depth = 0): Promise<void> {
    if (depth > 5 || this.downloaded.has(url)) return;

    this.assetMap.set(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const text = await this.getText(url);
    if (!text) {
      this.record(url, rel, "failed");
      this.progress.tickFail();
      return;
    }

    await Bun.write(join(this.outDir, rel), text);
    this.record(url, rel, "ok");
    this.progress.tick("css", basename(rel), text.length);

    const inner = this.extractCssAssets(text, url);

    for (const importUrl of inner.css) {
      if (this.downloaded.has(importUrl)) continue;
      const r = this.allocName(importUrl, "assets/css");
      this.progress.addTotal(1);
      await this.downloadCss(importUrl, r, depth + 1);
    }

    const binTasks: { type: keyof Progress["counts"]; url: string; rel: string }[] = [];

    for (const fontUrl of inner.fonts) {
      if (this.downloaded.has(fontUrl) || (this.skipCdn && this.isCdn(fontUrl))) continue;
      binTasks.push({ type: "font", url: fontUrl, rel: this.allocName(fontUrl, "assets/fonts") });
    }
    for (const imgUrl of inner.images) {
      if (this.downloaded.has(imgUrl) || (this.skipCdn && this.isCdn(imgUrl))) continue;
      binTasks.push({ type: "img", url: imgUrl, rel: this.allocName(imgUrl, "assets/images") });
    }

    this.progress.addTotal(binTasks.length);

    await this.parallel(
      binTasks.map((t) => () => this.downloadBin(t.url, t.rel, t.type))
    );
  }

  private async downloadBin(url: string, rel: string, type: keyof Progress["counts"]) {
    if (this.downloaded.has(url)) return;
    this.assetMap.set(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const dest = join(this.outDir, rel);
    const bytes = await this.saveBin(url, dest);
    if (bytes >= 0) {
      this.record(url, rel, "ok");
      this.progress.tick(type, basename(rel), bytes);
    } else {
      this.record(url, rel, "failed");
      this.progress.tickFail();
    }
  }

  // ── Rewrite ──────────────────────────────────────────────

  private rewriteHtml(html: string, baseUrl: string, depth: number): string {
    let result = html;
    const prefix = "../".repeat(depth);
    const sorted = [...this.assetMap.entries()].sort((a, b) => b[0].length - a[0].length);

    for (const [origUrl, localRel] of sorted) {
      const to = prefix + localRel;
      result = this.replaceAll(result, origUrl, to);

      try {
        const u = new URL(origUrl);
        result = this.replaceAll(result, u.pathname + u.search, to);
        if (u.origin === this.origin) {
          result = this.replaceAll(result, u.pathname, to);
        }
      } catch {
        // skip
      }
    }

    return result;
  }

  private async rewriteAllCss() {
    const cssDir = join(this.outDir, "assets", "css");
    const files = this.listDir(cssDir).filter((f) => f.endsWith(".css"));
    if (files.length === 0) return;

    const sorted = [...this.assetMap.entries()].sort((a, b) => b[0].length - a[0].length);

    for (const file of files) {
      let css = await Bun.file(join(cssDir, file)).text();
      const cssOrigUrl = this.findUrlByLocal(`assets/css/${file}`);

      for (const [origUrl, localRel] of sorted) {
        const relPath = relative(dirname(`assets/css/${file}`), localRel);
        css = this.replaceAll(css, origUrl, relPath);

        try {
          const u = new URL(origUrl);
          if (u.search) css = this.replaceAll(css, u.pathname + u.search, relPath);
          css = this.replaceAll(css, u.pathname, relPath);

          if (cssOrigUrl) {
            const resolved = new URL(origUrl, cssOrigUrl).href;
            if (resolved !== origUrl) {
              const ru = new URL(resolved);
              if (ru.search) css = this.replaceAll(css, ru.pathname + ru.search, relPath);
              css = this.replaceAll(css, ru.pathname, relPath);
              css = this.replaceAll(css, resolved, relPath);
            }
          }
        } catch {
          // skip
        }
      }

      // Strip leftover query strings from local url() paths
      css = css.replace(/url\(([^)]*)\)/g, (_match, inner: string) => {
        const cleaned = inner.replace(/^(['"]?)([^'"?]+)\?[^'"]*(['"]?)$/, "$1$2$3");
        return `url(${cleaned})`;
      });

      await Bun.write(join(cssDir, file), css);
    }
  }

  // ── HTTP (native fetch) ──────────────────────────────────

  private get fetchHeaders(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Linux"',
      ...this.extraHeaders,
    };
  }

  private async getText(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: this.fetchHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }

  private async saveBin(url: string, dest: string): Promise<number> {
    try {
      const res = await fetch(url, {
        headers: this.fetchHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return -1;
      const buf = await res.arrayBuffer();
      await Bun.write(dest, buf);
      return buf.byteLength;
    } catch {
      return -1;
    }
  }

  // ── Concurrency ──────────────────────────────────────────

  private async parallel(tasks: (() => Promise<unknown>)[]) {
    if (tasks.length === 0) return;
    let idx = 0;

    const worker = async () => {
      while (idx < tasks.length) {
        const i = idx++;
        await tasks[i]();
      }
    };

    const count = Math.min(this.concurrency, tasks.length);
    await Promise.all(Array.from({ length: count }, () => worker()));
  }

  // ── Output files ─────────────────────────────────────────

  private async writeServerFile() {
    const lines = [
      "#!/usr/bin/env bun",
      "",
      "const MIME: Record<string, string> = {",
      '  ".html": "text/html; charset=utf-8",',
      '  ".css": "text/css",',
      '  ".js": "application/javascript",',
      '  ".mjs": "application/javascript",',
      '  ".json": "application/json",',
      '  ".png": "image/png",',
      '  ".jpg": "image/jpeg",',
      '  ".jpeg": "image/jpeg",',
      '  ".gif": "image/gif",',
      '  ".svg": "image/svg+xml",',
      '  ".ico": "image/x-icon",',
      '  ".webp": "image/webp",',
      '  ".avif": "image/avif",',
      '  ".woff": "font/woff",',
      '  ".woff2": "font/woff2",',
      '  ".ttf": "font/ttf",',
      '  ".eot": "application/vnd.ms-fontobject",',
      '  ".otf": "font/otf",',
      '  ".mp4": "video/mp4",',
      '  ".webm": "video/webm",',
      "};",
      "",
      'const port = parseInt(Bun.argv[2] || "3000", 10);',
      "",
      "Bun.serve({",
      "  port,",
      "  fetch(req) {",
      "    const { pathname } = new URL(req.url);",
      '    const decoded = "." + decodeURIComponent(pathname);',
      '    const raw = "." + pathname;',
      '    const bases = decoded === "./" ? ["./index.html"] : [decoded, raw];',
      "    const candidates: string[] = [];",
      '    for (const b of bases) candidates.push(b, b + ".html", b + "/index.html");',
      "",
      "    for (const c of candidates) {",
      "      const f = Bun.file(c);",
      "      if (f.size > 0) {",
      '        const ext = c.slice(c.lastIndexOf(".")).toLowerCase();',
      '        return new Response(f, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });',
      "      }",
      "    }",
      '    return new Response("Not found", { status: 404 });',
      "  },",
      "});",
      "",
      "console.log(`http://localhost:${port}`);",
      "",
    ];

    await Bun.write(join(this.outDir, "server.ts"), lines.join("\n"));
  }

  private async writeManifest() {
    const entries: Record<string, DownloadRecord> = {};
    for (const [url, info] of this.downloaded) entries[url] = info;
    await Bun.write(join(this.outDir, "manifest.json"), JSON.stringify(entries, null, 2));
  }

  // ── Utilities ────────────────────────────────────────────

  private abs(url: string, base: string): string {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  private isCdn(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h !== this.target.hostname && CDN_PATTERNS.some((p) => url.includes(p));
    } catch {
      return false;
    }
  }

  private isFont(url: string): boolean {
    return /\.(woff2?|ttf|eot|otf)(\?|$)/i.test(url);
  }

  private allocName(url: string, dir: string): string {
    let name: string;
    try {
      name = basename(new URL(url).pathname).split("?")[0];
    } catch {
      name = "file";
    }
    if (!name || name === "/" || name === "") name = "file";

    let ext = extname(name);
    if (!ext) {
      if (dir.includes("css")) ext = ".css";
      else if (dir.includes("js")) ext = ".js";
      else if (dir.includes("font")) ext = ".woff2";
      if (ext) name += ext;
    }

    const key = `${dir}/${name}`;
    const count = this.nameCounters.get(key) ?? 0;
    this.nameCounters.set(key, count + 1);

    if (count > 0) {
      const base = name.slice(0, name.length - ext.length);
      name = `${base}-${count}${ext}`;
    }

    mkdirSync(join(this.outDir, dir), { recursive: true });
    return `${dir}/${name}`;
  }

  private pageSlug(url: string): string {
    try {
      const u = new URL(url);
      let slug = u.pathname.replace(/^\//, "").replace(/\//g, "-").replace(/\.$/, "");
      if (!slug) slug = "page";
      if (!slug.endsWith(".html")) slug += ".html";
      return slug;
    } catch {
      return "page.html";
    }
  }

  private dedup(a: Assets): Assets {
    return {
      css: [...new Set(a.css)],
      js: [...new Set(a.js)],
      images: [...new Set(a.images)],
      fonts: [...new Set(a.fonts)],
      icons: [...new Set(a.icons)],
    };
  }

  private record(url: string, local: string, status: DownloadRecord["status"]) {
    this.downloaded.set(url, { local, status });
    if (status === "failed") this.failed.push(url);
  }

  private findUrlByLocal(local: string): string | undefined {
    for (const [url, rel] of this.assetMap) {
      if (rel === local) return url;
    }
    return undefined;
  }

  private listDir(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }

  private replaceAll(str: string, search: string, replacement: string): string {
    if (!search || !str.includes(search)) return str;
    return str.split(search).join(replacement);
  }
}

// ── CLI ────────────────────────────────────────────────────

function parseArgs() {
  const args = Bun.argv.slice(2);
  const opts: CloneOpts = {};
  const positional: string[] = [];

  const headers: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--pages":
        opts.pages = parseInt(args[++i], 10);
        break;
      case "--images":
        opts.images = parseInt(args[++i], 10);
        break;
      case "--no-cdn":
        opts.noCdn = true;
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        break;
      case "--cookie":
      case "-b":
        opts.cookie = args[++i];
        break;
      case "--header":
      case "-H": {
        const val = args[++i];
        const sep = val.indexOf(":");
        if (sep > 0) headers[val.slice(0, sep).trim()] = val.slice(sep + 1).trim();
        break;
      }
      case "--help":
      case "-h":
        console.log(
          [
            "",
            "Usage: bun clone.ts <url> [output-dir] [options]",
            "",
            "Options:",
            "  --pages <n>        Max internal pages (default: 20, 0 = homepage only)",
            "  --images <n>       Max images (default: 200, 0 = unlimited)",
            "  --no-cdn           Skip third-party CDN assets",
            "  --concurrency <n>  Parallel downloads (default: 8)",
            "  --cookie, -b <s>   Cookie header (e.g. 'device=desktop')",
            "  --header, -H <s>   Extra header (e.g. 'Accept-Language: ru')",
            "",
          ].join("\n")
        );
        process.exit(0);
        break;
      default:
        if (!args[i].startsWith("-")) positional.push(args[i]);
    }
  }

  if (Object.keys(headers).length > 0) opts.headers = headers;

  if (!positional[0]) {
    console.error("Usage: bun clone.ts <url> [output-dir]");
    process.exit(1);
  }

  return { url: positional[0], dir: positional[1] ?? "cloned-site", opts };
}

const { url, dir, opts } = parseArgs();
await new Cloner(url, dir, opts).run();
