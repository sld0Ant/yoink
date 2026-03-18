import { join, basename } from "node:path";
import { CDN_HOSTNAMES } from "./constants";
import { extractCssAssets } from "./extractor";
import { Fetcher } from "./fetcher";
import { Namer } from "./namer";
import type { Assets, AssetType, DownloadRecord, ProgressReporter } from "./types";

export class Downloader {
  private downloaded = new Map<string, DownloadRecord>();
  private failed: string[] = [];
  private localToUrl = new Map<string, string>();
  assetMap = new Map<string, string>();
  private imgCount = 0;

  constructor(
    private fetcher: Fetcher,
    private namer: Namer,
    private progress: ProgressReporter,
    private outDir: string,
    private maxImages: number,
    private skipCdn: boolean,
    private targetHost: string,
    private concurrency: number,
    private errors: Map<string, string> = new Map(),
  ) {}

  seedFromManifest(records: Record<string, { local: string; status: string }>) {
    for (const [url, rec] of Object.entries(records)) {
      if (rec.status !== "ok") continue;
      this.downloaded.set(url, { local: rec.local, status: "ok" });
      this.assetMap.set(url, rec.local);
      this.localToUrl.set(rec.local, url);
    }
  }

  get records() {
    return this.downloaded;
  }

  get failures() {
    return this.failed;
  }

  findUrlByLocal(local: string): string | undefined {
    return this.localToUrl.get(local);
  }

  async downloadAssets(assets: Assets) {
    const tasks: { type: AssetType; url: string; rel: string }[] = [];

    for (const url of assets.css) {
      if (this.shouldSkip(url)) continue;
      tasks.push({ type: "css", url, rel: this.namer.alloc(url, "assets/css") });
    }

    for (const url of assets.js) {
      if (this.shouldSkip(url)) continue;
      tasks.push({ type: "js", url, rel: this.namer.alloc(url, "assets/js") });
    }

    for (const url of assets.images) {
      if (this.shouldSkip(url)) continue;
      if (this.maxImages > 0 && this.imgCount >= this.maxImages) continue;
      this.imgCount++;
      tasks.push({ type: "img", url, rel: this.namer.alloc(url, "assets/images") });
    }

    for (const url of assets.fonts) {
      if (this.shouldSkip(url)) continue;
      tasks.push({ type: "font", url, rel: this.namer.alloc(url, "assets/fonts") });
    }

    for (const url of assets.icons) {
      if (this.shouldSkip(url)) continue;
      tasks.push({ type: "icon", url, rel: this.namer.alloc(url, "assets/images") });
    }

    this.progress.addTotal(tasks.length);

    await this.parallel(
      tasks.map((t) => () => (t.type === "css" ? this.downloadCss(t.url, t.rel) : this.downloadBin(t.url, t.rel, t.type)))
    );
  }

  async downloadPage(pageUrl: string, slug: string, html: string) {
    await Bun.write(join(this.outDir, "pages", slug), html);
    this.mapAsset(pageUrl, `pages/${slug}`);
    this.record(pageUrl, `pages/${slug}`, "ok");
    this.progress.tick("page", slug, html.length);
  }

  private async downloadCss(url: string, rel: string, depth = 0): Promise<void> {
    if (depth > 5 || this.downloaded.has(url)) return;

    this.mapAsset(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const text = await this.fetcher.text(url);
    if (!text) {
      this.record(url, rel, "failed", this.errors.get(url));
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
      if (this.shouldSkip(fontUrl)) continue;
      binTasks.push({ type: "font", url: fontUrl, rel: this.namer.alloc(fontUrl, "assets/fonts") });
    }
    for (const imgUrl of inner.images) {
      if (this.shouldSkip(imgUrl)) continue;
      binTasks.push({ type: "img", url: imgUrl, rel: this.namer.alloc(imgUrl, "assets/images") });
    }

    this.progress.addTotal(binTasks.length);
    await this.parallel(binTasks.map((t) => () => this.downloadBin(t.url, t.rel, t.type)));
  }

  private async downloadBin(url: string, rel: string, type: AssetType) {
    if (this.downloaded.has(url)) return;
    this.mapAsset(url, rel);
    this.downloaded.set(url, { local: rel, status: "pending" });

    const result = await this.fetcher.binary(url, join(this.outDir, rel));
    if (result.bytes >= 0) {
      this.record(url, rel, "ok");
      this.progress.tick(type, basename(rel), result.bytes);
    } else {
      this.record(url, rel, "failed", result.error);
      this.progress.tickFail();
    }
  }

  private shouldSkip(url: string): boolean {
    if (this.downloaded.has(url)) return true;
    if (!this.skipCdn) return false;
    try {
      const h = new URL(url).hostname;
      return h !== this.targetHost && CDN_HOSTNAMES.has(h);
    } catch {
      return false;
    }
  }

  private mapAsset(url: string, rel: string) {
    this.assetMap.set(url, rel);
    this.localToUrl.set(rel, url);
  }

  private record(url: string, local: string, status: DownloadRecord["status"], error?: string) {
    this.downloaded.set(url, { local, status, ...(error && { error }) });
    if (status === "failed") this.failed.push(url);
  }

  private async parallel(tasks: (() => Promise<unknown>)[]) {
    if (tasks.length === 0) return;
    let idx = 0;
    const worker = async () => {
      while (idx < tasks.length) {
        const i = idx++;
        await tasks[i]();
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, tasks.length) }, () => worker()));
  }
}
