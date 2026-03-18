import { join, dirname } from "node:path";
import type { DownloadRecord } from "./types";

const TEMPLATE_PATH = join(dirname(import.meta.dir), "templates", "server.ts");

export async function writeServer(outDir: string) {
  const template = await Bun.file(TEMPLATE_PATH).text();
  await Bun.write(join(outDir, "server.ts"), template);
}

export async function writeManifest(outDir: string, downloaded: Map<string, DownloadRecord>) {
  const entries: Record<string, DownloadRecord> = {};
  for (const [url, info] of downloaded) entries[url] = info;
  await Bun.write(join(outDir, "manifest.json"), JSON.stringify(entries, null, 2));
}
