import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Cloner } from "./cloner";

export function createServer() {
  const server = new McpServer({
    name: "yoink",
    version: "0.2.0",
  });

  server.tool(
    "clone",
    "Clone a website with all assets (HTML, CSS, JS, images, fonts) for local offline use",
    {
      url: z.string().describe("URL of the website to clone"),
      outputDir: z.string().optional().describe("Output directory (default: cloned-site)"),
      pages: z.number().optional().describe("Max internal pages to follow (default: 20, 0 = homepage only)"),
      images: z.number().optional().describe("Max images to download (default: 200, 0 = unlimited)"),
      noCdn: z.boolean().optional().describe("Skip third-party CDN assets"),
      concurrency: z.number().optional().describe("Parallel downloads (default: 8)"),
      cookie: z.string().optional().describe("Cookie header (e.g. 'device=desktop')"),
      resume: z.boolean().optional().describe("Skip already downloaded assets"),
      inlineScripts: z.boolean().optional().describe("Embed script src content in HTML"),
      inlineStyles: z.boolean().optional().describe("Embed stylesheet content in HTML"),
    },
    async ({ url, outputDir: dir, ...opts }) => {
      const outputDir = dir ?? "cloned-site";
      try {
        const cloner = new Cloner(url, outputDir, { ...opts, silent: true });
        const result = await cloner.run();

        const summary = {
          ok: result.ok,
          failed: result.failed,
          elapsed: Math.round(result.elapsed * 10) / 10,
          outputDir,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }],
          isError: true,
        };
      }
    }
  );

  return server;
}
