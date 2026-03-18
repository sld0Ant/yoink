import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { ANSI, CDN_PATTERNS } from "./constants";
import { extractHtmlAssets, extractCssAssets, extractInternalLinks } from "./extractor";
import { Fetcher } from "./fetcher";
import { Namer } from "./namer";
import { writeServer, writeManifest } from "./output";
import { Progress } from "./progress";
import { rewriteHtml, rewriteCss } from "./rewriter";
import type { Assets, AssetType, CloneOpts, DownloadRecord } from "./types";

const { bold, cyan, green, red, reset } = ANSI;

export class Cloner {
  private target: URL;
  private origin: string;
  private outDir: string;
  private maxPages: number;
  private maxImages: number;
  private skipCdn: boolean;
  private concurrency: number;

  private fetcher: Fetcher;
  private namer: Namer;
  private progress = new Progress();

  private downloaded = new Map<string, DownloadRecord>();
  private failed: string[] = [];
  private assetMap = new Map<string, string>();
  private imgCount = 0;

  constructor(targetUrl: string, outDir: string, opts: CloneOpts = {}) {
    this.target = new URL(targetUrl);
    this.origin = this.target.origin;
    this.outDir = resolve(outDir);
    this.maxPages = opts.pages ?? 20;
    this.maxImages = opts.images ?? 200;
    this.skipCdn = opts.noCdn ?? false;
    this.concurrency = opts.concurrency ?? 8;

    const extraHeaders: Record<string, string> = { ...opts.headers };
    if (opts.cookie) extraHeaders["Cookie"] = opts.cookie;

    this.fetcher = new Fetcher(extraHeaders);
    this.namer = new Namer(this.outDir);
  }

  async run() {
    const t0 = performance.now();
    console.log(`\n  ${bold}${this.target.hostname}${reset} → ${cyan}${basename(this.outDir)}${reset}\n`);

    this.progress.start();
    this.createDirs();

    this.progress.setPhase("Fetching homepage");
    const homeHtml = await this.fetcher.text(this.target.href);
    if (!homeHtml) {
      this.progress.stop();
      console.error(`\n  ${red}Failed to fetch homepage${reset}`);
      process.exit(1);
    }

    this.progress.setPhase("Downloading assets");
    await this.downloadAssets(extractHtmlAssets(homeHtml, this.target.href));

    await this.downloadPages(homeHtml);

    this.progress.setPhase("Rewriting paths");
    await this.rewriteAll(homeHtml);

    await writeServer(this.outDir);
    await writeManifest(this.outDir, this.downloaded);

    this.progress.stop();
    this.printSummary(t0);
  }

  private createDirs() {
    for (const d of ["", "assets/css", "assets/js", "assets/images", "assets/fonts", "pages"]) {
      mkdirSync(join(this.outDir, d), { recursive: true });
    }
  }

  private async downloadPages(homeHtml: string) {
    if (this.maxPages <= 0) return;

    const homePath = this.target.origin + this.target.pathname;
    const allLinks = extractInternalLinks(homeHtml, this.target.href, this.origin, homePath);
    const pages = allLinks.slice(0, this.maxPages);
    if (pages.length === 0) return;

    this.progress.setPhase("Downloading pages");
    this.progress.addTotal(pages.length);

    for (const pageUrl of pages) {
      const html = await this.fetcher.text(pageUrl);
      if (!html) {
        this.progress.tickFail();
        continue;
      }

      const slug = this.namer.pageSlug(pageUrl);
      await Bun.write(join(this.outDir, "pages", slug), html);
      this.assetMap.set(pageUrl, `pages/${slug}`);
      this.record(pageUrl, `pages/${slug}`, "ok");
      this.progress.tick("page", slug, html.length);

      await this.downloadAssets(extractHtmlAssets(html, pageUrl));
    }
  }

  private async rewriteAll(homeHtml: string) {
    const rewrittenHome = rewriteHtml(homeHtml, this.origin, this.assetMap, 0);
    await Bun.write(join(this.outDir, "index.html"), rewrittenHome);

    const pagesDir = join(this.outDir, "pages");
    for (const file of listDir(pagesDir)) {
      if (!file.endsWith(".html")) continue;
      const raw = await Bun.file(join(pagesDir, file)).text();
      const pageUrl = this.findUrlByLocal(`pages/${file}`);
      const rewritten = rewriteHtml(raw, this.origin, this.assetMap, 1);
      await Bun.write(join(pagesDir, file), rewritten);
    }

    const cssDir = join(this.outDir, "assets", "css");
    for (const file of listDir(cssDir).filter((f) => f.endsWith(".css"))) {
      const raw = await Bun.file(join(cssDir, file)).text();
      const cssOrigUrl = this.findUrlByLocal(`assets/css/${file}`);
      const rewritten = rewriteCss(raw, file, cssOrigUrl, this.assetMap);
      await Bun.write(join(cssDir, file), rewritten);
    }
  }

  // ── Download ─────────────────────────────────────────────

  private async downloadAssets(assets: Assets) {
    const tasks: { type: AssetType; url: string; rel: string }[] = [];

    for (const url of assets.css) {
      if (this.skip(url)) continue;
      tasks.push({ type: "css", url, rel: this.namer.alloc(url, "assets/css") });
    }

    for (const url of assets.js) {
      if (this.skip(url)) continue;
      tasks.push({ type: "js", url, rel: this.namer.alloc(url, "assets/js") });
    }

    for (const url of assets.images) {
      if (this.skip(url)) continue;
      if (this.maxImages > 0 && this.imgCount >= this.maxImages) continue;
      this.imgCount++;
      tasks.push({ type: "img", url, rel: this.namer.alloc(url, "assets/images") });
    }

    for (const url of assets.fonts) {
      if (this.skip(url)) continue;
      tasks.push({ type: "font", url, rel: this.namer.alloc(url, "assets/fonts") });
    }

    for (const url of assets.icons) {
      if (this.downloaded.has(url)) continue;
      tasks.push({ type: "icon", url, rel: this.namer.alloc(url, "assets/images") });
    }

    this.progress.addTotal(tasks.length);

    await this.parallel(
      tasks.map((t) => () => (t.type === "css" ? this.downloadCss(t.url, t.rel) : this.downloadBin(t.url, t.rel, t.type)))
    );
  }

  private async downloadCss(url: string, rel: string, depth = 0): Promise<void> {
    if (depth > 5 || this.downloaded.has(url)) return;

    this.assetMap.set(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const text = await this.fetcher.text(url);
    if (!text) {
      this.record(url, rel, "failed");
      this.progress.tickFail();
      return;
    }

    await Bun.write(join(this.outDir, rel), text);
    this.record(url, rel, "ok");
    this.progress.tick("css", basename(rel), text.length);

    const inner = extractCssAssets(text, url);

    for (const importUrl of inner.css) {
      if (this.downloaded.has(importUrl)) continue;
      const r = this.namer.alloc(importUrl, "assets/css");
      this.progress.addTotal(1);
      await this.downloadCss(importUrl, r, depth + 1);
    }

    const binTasks: { type: AssetType; url: string; rel: string }[] = [];

    for (const fontUrl of inner.fonts) {
      if (this.skip(fontUrl)) continue;
      binTasks.push({ type: "font", url: fontUrl, rel: this.namer.alloc(fontUrl, "assets/fonts") });
    }
    for (const imgUrl of inner.images) {
      if (this.skip(imgUrl)) continue;
      binTasks.push({ type: "img", url: imgUrl, rel: this.namer.alloc(imgUrl, "assets/images") });
    }

    this.progress.addTotal(binTasks.length);
    await this.parallel(binTasks.map((t) => () => this.downloadBin(t.url, t.rel, t.type)));
  }

  private async downloadBin(url: string, rel: string, type: AssetType) {
    if (this.downloaded.has(url)) return;
    this.assetMap.set(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const bytes = await this.fetcher.binary(url, join(this.outDir, rel));
    if (bytes >= 0) {
      this.record(url, rel, "ok");
      this.progress.tick(type, basename(rel), bytes);
    } else {
      this.record(url, rel, "failed");
      this.progress.tickFail();
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  private skip(url: string): boolean {
    return this.downloaded.has(url) || (this.skipCdn && isCdn(url, this.target.hostname));
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

  private async parallel(tasks: (() => Promise<unknown>)[]) {
    if (tasks.length === 0) return;
    let idx = 0;
    const worker = async () => {
      while (idx < tasks.length) await tasks[idx++]();
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, tasks.length) }, () => worker()));
  }

  private printSummary(t0: number) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const okCount = [...this.downloaded.values()].filter((d) => d.status === "ok").length;
    const failCount = this.failed.length;
    console.log(`  ${green}✓${reset} ${bold}Done${reset} in ${elapsed}s — ${green}${okCount} downloaded${reset}${failCount ? `, ${red}${failCount} failed${reset}` : ""}`);
    console.log(`  ${ANSI.gray}Run:${reset}  cd ${basename(this.outDir)} && bun server.ts`);
    console.log(`  ${ANSI.gray}Open:${reset} ${cyan}http://localhost:3000${reset}\n`);
  }
}

function isCdn(url: string, targetHost: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h !== targetHost && CDN_PATTERNS.some((p) => url.includes(p));
  } catch {
    return false;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
