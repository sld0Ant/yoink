import { statSync } from "node:fs";
import { join } from "node:path";
import type { DownloadRecord, SiteSummary } from "./types";

export function buildSummary(
  url: string,
  outDir: string,
  maxPages: number,
  elapsed: number,
  records: Map<string, DownloadRecord>,
): SiteSummary {
  const assets = { pages: 0, css: 0, js: 0, images: 0, fonts: 0, total: 0 };
  let totalBytes = 0;
  const domains = new Set<string>();
  const failed: { url: string; reason: string }[] = [];

  for (const [assetUrl, rec] of records) {
    try {
      domains.add(new URL(assetUrl).hostname);
    } catch {}

    if (rec.status === "failed") {
      failed.push({ url: assetUrl, reason: rec.error ?? "unknown" });
      continue;
    }
    if (rec.status !== "ok") continue;

    assets.total++;
    const local = rec.local;
    if (local.startsWith("pages/")) assets.pages++;
    else if (local.startsWith("assets/css/")) assets.css++;
    else if (local.startsWith("assets/js/")) assets.js++;
    else if (local.startsWith("assets/images/")) assets.images++;
    else if (local.startsWith("assets/fonts/")) assets.fonts++;

    try {
      totalBytes += statSync(join(outDir, local)).size;
    } catch {}
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  return {
    url,
    hostname,
    clonedAt: new Date().toISOString(),
    elapsed: Math.round(elapsed * 10) / 10,
    maxPages,
    pagesDownloaded: assets.pages,
    assets,
    totalBytes,
    domains: [...domains].sort(),
    failed,
    outputDir: outDir,
  };
}

export async function writeSummary(outDir: string, summary: SiteSummary) {
  await Bun.write(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
}
