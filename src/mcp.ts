import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Cloner } from "./cloner";

export function createServer() {
  const server = new McpServer({ name: "yoink", version: "0.2.0" });

  server.tool(
    "clone",
    "Clone a website with all assets (HTML, CSS, JS, images, fonts) for local offline use. Returns a full summary with asset breakdown, domains, and failures.",
    {
      url: z.string().describe("URL of the website to clone"),
      outputDir: z.string().optional().describe("Output directory (default: derived from hostname)"),
      pages: z.number().optional().describe("Max internal pages to follow (default: 20, 0 = homepage only)"),
      images: z.number().optional().describe("Max images to download (default: 200, 0 = unlimited)"),
      noCdn: z.boolean().optional().describe("Skip third-party CDN assets"),
      concurrency: z.number().optional().describe("Parallel downloads (default: 8)"),
      cookie: z.string().optional().describe("Cookie header (e.g. 'device=desktop')"),
      inlineScripts: z.boolean().optional().describe("Embed script src content in HTML"),
      inlineStyles: z.boolean().optional().describe("Embed stylesheet content in HTML"),
    },
    async ({ url, outputDir, ...opts }) => {
      const dir = outputDir ?? defaultDirName(url);
      try {
        const cloner = new Cloner(url, dir, { ...opts, silent: true });
        const result = await cloner.run();
        return ok(result.summary);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list",
    "List previously cloned websites in a directory. Scans subdirectories for summary.json files.",
    {
      directory: z.string().optional().describe("Directory to scan (default: current directory)"),
    },
    async ({ directory }) => {
      const dir = resolve(directory ?? ".");
      const sites: {
        directory: string;
        url: string;
        hostname: string;
        clonedAt: string;
        assetsOk: number;
        failed: number;
        totalBytes: number;
      }[] = [];

      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const sp = join(dir, entry.name, "summary.json");
          if (!existsSync(sp)) continue;
          try {
            const s = JSON.parse(readFileSync(sp, "utf8"));
            sites.push({
              directory: entry.name,
              url: s.url,
              hostname: s.hostname,
              clonedAt: s.clonedAt,
              assetsOk: s.assets?.total ?? 0,
              failed: s.failed?.length ?? 0,
              totalBytes: s.totalBytes ?? 0,
            });
          } catch {}
        }
      } catch {}

      if (sites.length === 0) {
        return ok({ message: "No cloned sites found", scanned: dir });
      }
      return ok(sites);
    },
  );

  server.tool(
    "inspect",
    "Inspect a cloned website — show full summary with asset breakdown, domains, and failures.",
    {
      directory: z.string().describe("Path to the cloned site directory"),
    },
    async ({ directory }) => {
      const dir = resolve(directory);
      const sp = join(dir, "summary.json");
      if (!existsSync(sp)) {
        return err(new Error(`No summary.json in ${dir}. Clone the site first or re-clone with resume.`));
      }
      try {
        const summary = JSON.parse(readFileSync(sp, "utf8"));
        return ok(summary);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "resume",
    "Resume a partial or failed clone — re-downloads only missing assets using the existing manifest.",
    {
      directory: z.string().describe("Path to the previously cloned site directory"),
    },
    async ({ directory }) => {
      const dir = resolve(directory);
      const sp = join(dir, "summary.json");
      if (!existsSync(sp)) {
        return err(new Error(`No summary.json in ${dir} — cannot determine source URL`));
      }
      try {
        const prev = JSON.parse(readFileSync(sp, "utf8"));
        const cloner = new Cloner(prev.url, dir, {
          pages: prev.maxPages,
          resume: true,
          silent: true,
        });
        const result = await cloner.run();
        return ok(result.summary);
      } catch (e) {
        return err(e);
      }
    },
  );

  return server;
}

function defaultDirName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "cloned-site";
  }
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }],
    isError: true,
  };
}
