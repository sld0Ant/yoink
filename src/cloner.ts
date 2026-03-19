import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { ANSI } from "./constants";
import { Downloader } from "./downloader";
import { extractHtmlAssets, extractInternalLinks } from "./extractor";
import { Fetcher } from "./fetcher";
import { inlineScripts, inlineStyles } from "./inliner";
import { Namer } from "./namer";
import { writeServer, writeManifest } from "./output";
import { Progress, SilentProgress } from "./progress";
import { rewriteHtml, rewriteCss } from "./rewriter";
import type { CloneOpts, DownloadRecord } from "./types";

const { bold, cyan, green, red, reset } = ANSI;

export interface CloneResult {
  ok: number;
  failed: number;
  elapsed: number;
  records: Map<string, DownloadRecord>;
}

export class Cloner {
  private target: URL;
  private origin: string;
  private outDir: string;
  private maxPages: number;
  private resume: boolean;
  private doInlineScripts: boolean;
  private doInlineStyles: boolean;
  private silent: boolean;

  private fetcher: Fetcher;
  private namer: Namer;
  private progress: Progress | SilentProgress;
  private dl: Downloader;

  constructor(targetUrl: string, outDir: string, opts: CloneOpts = {}) {
    this.target = new URL(targetUrl);
    this.origin = this.target.origin;
    this.outDir = resolve(outDir);
    this.maxPages = opts.pages ?? 20;
    this.resume = opts.resume ?? false;
    this.doInlineScripts = opts.inlineScripts ?? false;
    this.doInlineStyles = opts.inlineStyles ?? false;
    this.silent = opts.silent ?? false;
    this.progress = this.silent ? new SilentProgress() : new Progress();

    const extraHeaders: Record<string, string> = { ...opts.headers };
    if (opts.cookie) extraHeaders["Cookie"] = opts.cookie;

    this.namer = new Namer(this.outDir);

    const errorMap = new Map<string, string>();
    this.fetcher = new Fetcher({
      headers: extraHeaders,
      onError: (url, reason) => errorMap.set(url, reason),
      retries: opts.retries,
      retryDelay: opts.retryDelay,
    });
    this.dl = new Downloader(
      this.fetcher,
      this.namer,
      this.progress,
      this.outDir,
      opts.images ?? 200,
      opts.noCdn ?? false,
      this.target.hostname,
      opts.concurrency ?? 8,
      errorMap,
    );
  }

  async run(): Promise<CloneResult> {
    const t0 = performance.now();
    if (!this.silent) console.log(`\n  ${bold}${this.target.hostname}${reset} → ${cyan}${basename(this.outDir)}${reset}\n`);

    this.progress.start();
    this.createDirs();
    this.loadResume();

    this.progress.setPhase("Fetching homepage");
    const homeHtml = await this.fetcher.text(this.target.href);
    if (!homeHtml) {
      this.progress.stop();
      throw new Error(`Failed to fetch homepage: ${this.target.href}`);
    }

    this.progress.setPhase("Downloading assets");
    await this.dl.downloadAssets(extractHtmlAssets(homeHtml, this.target.href));

    await this.downloadPages(homeHtml);

    this.progress.setPhase("Rewriting paths");
    await this.rewriteAll(homeHtml);

    await writeServer(this.outDir);
    await writeManifest(this.outDir, this.dl.records);

    this.progress.stop();

    const elapsed = (performance.now() - t0) / 1000;
    const ok = [...this.dl.records.values()].filter((d) => d.status === "ok").length;
    const failed = this.dl.failures.length;

    if (!this.silent) this.printSummary(elapsed, ok, failed);

    return { ok, failed, elapsed, records: this.dl.records };
  }

  private loadResume() {
    if (!this.resume) return;
    const manifestPath = join(this.outDir, "manifest.json");
    if (!existsSync(manifestPath)) return;

    try {
      const raw = require("node:fs").readFileSync(manifestPath, "utf8");
      const records = JSON.parse(raw);
      this.dl.seedFromManifest(records);
      this.namer.seed(
        Object.values(records)
          .filter((r: any) => r.status === "ok")
          .map((r: any) => r.local)
      );
    } catch {
      // corrupted manifest — proceed without resume
    }
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
      await this.dl.downloadPage(pageUrl, slug, html);
      await this.dl.downloadAssets(extractHtmlAssets(html, pageUrl));
    }
  }

  private async rewriteAll(homeHtml: string) {
    const { assetMap } = this.dl;

    let rewrittenHome = rewriteHtml(homeHtml, this.origin, assetMap, 0);
    rewrittenHome = await this.applyInline(rewrittenHome, 0);
    await Bun.write(join(this.outDir, "index.html"), rewrittenHome);

    const pagesDir = join(this.outDir, "pages");
    for (const file of listDir(pagesDir)) {
      if (!file.endsWith(".html")) continue;
      const raw = await Bun.file(join(pagesDir, file)).text();
      let rewritten = rewriteHtml(raw, this.origin, assetMap, 1);
      rewritten = await this.applyInline(rewritten, 1);
      await Bun.write(join(pagesDir, file), rewritten);
    }

    const cssDir = join(this.outDir, "assets", "css");
    for (const file of listDir(cssDir).filter((f) => f.endsWith(".css"))) {
      const raw = await Bun.file(join(cssDir, file)).text();
      const origUrl = this.dl.findUrlByLocal(`assets/css/${file}`);
      const rewritten = rewriteCss(raw, file, origUrl, assetMap);
      await Bun.write(join(cssDir, file), rewritten);
    }

    const jsDir = join(this.outDir, "assets", "js");
    for (const file of listDir(jsDir).filter((f) => f.endsWith(".js"))) {
      const raw = await Bun.file(join(jsDir, file)).text();
      let rewritten = raw;
      for (const [origUrl, localRel] of [...assetMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
        if (!origUrl.startsWith("http")) continue;
        rewritten = rewritten.split(origUrl).join(localRel);
      }
      if (rewritten !== raw) await Bun.write(join(jsDir, file), rewritten);
    }
  }

  private async applyInline(html: string, _depth: number): Promise<string> {
    let result = html;
    if (this.doInlineScripts) result = await inlineScripts(result, this.outDir);
    if (this.doInlineStyles) result = await inlineStyles(result, this.outDir);
    return result;
  }

  private printSummary(elapsed: number, ok: number, failed: number) {
    const s = elapsed.toFixed(1);
    console.log(`  ${green}✓${reset} ${bold}Done${reset} in ${s}s — ${green}${ok} downloaded${reset}${failed ? `, ${red}${failed} failed${reset}` : ""}`);
    console.log(`  ${ANSI.gray}Run:${reset}  cd ${basename(this.outDir)} && bun server.ts`);
    console.log(`  ${ANSI.gray}Open:${reset} ${cyan}http://localhost:3000${reset}\n`);
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
