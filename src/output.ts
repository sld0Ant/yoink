import { join } from "node:path";
import type { DownloadRecord } from "./types";

export async function writeServer(outDir: string) {
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
    "const root = process.cwd() + \"/\";",
    "",
    "function safe(p: string): string | null {",
    "  try {",
    "    const { resolve } = require('node:path');",
    "    const abs = resolve(p);",
    "    return abs.startsWith(root) || abs === root.slice(0, -1) ? abs : null;",
    "  } catch { return null; }",
    "}",
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
    "      const resolved = safe(c);",
    "      if (!resolved) continue;",
    "      const f = Bun.file(resolved);",
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

  await Bun.write(join(outDir, "server.ts"), lines.join("\n"));
}

export async function writeManifest(outDir: string, downloaded: Map<string, DownloadRecord>) {
  const entries: Record<string, DownloadRecord> = {};
  for (const [url, info] of downloaded) entries[url] = info;
  await Bun.write(join(outDir, "manifest.json"), JSON.stringify(entries, null, 2));
}
