import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Cloner } from "../src/cloner";

const TMP = join(import.meta.dir, ".tmp-cloner");
let server: ReturnType<typeof Bun.serve>;
let port: number;

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        return new Response(
          `<html>
            <head>
              <link rel="stylesheet" href="/style.css">
              <script src="/app.js"></script>
              <link rel="icon" href="/favicon.ico">
            </head>
            <body>
              <img src="/hero.png">
              <a href="/about">About</a>
            </body>
          </html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }
      if (pathname === "/about") {
        return new Response(
          `<html><body><h1>About</h1><img src="/team.png"></body></html>`,
          { headers: { "Content-Type": "text/html" } }
        );
      }
      if (pathname === "/style.css") {
        return new Response(
          `body { background: url(/bg.jpg); } @font-face { src: url(/font.woff2); }`,
          { headers: { "Content-Type": "text/css" } }
        );
      }
      if (pathname === "/app.js") return new Response("console.log('app')");
      if (pathname === "/hero.png") return new Response(Buffer.alloc(100));
      if (pathname === "/team.png") return new Response(Buffer.alloc(50));
      if (pathname === "/bg.jpg") return new Response(Buffer.alloc(200));
      if (pathname === "/font.woff2") return new Response(Buffer.alloc(80));
      if (pathname === "/favicon.ico") return new Response(Buffer.alloc(16));
      return new Response("404", { status: 404 });
    },
  });
  port = server.port;
});

afterEach(() => {
  server.stop();
  rmSync(TMP, { recursive: true, force: true });
});

describe("Cloner", () => {
  it("clones homepage with all asset types", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    const result = await c.run();

    expect(result.ok).toBeGreaterThan(0);
    expect(result.elapsed).toBeGreaterThan(0);
    expect(existsSync(join(TMP, "index.html"))).toBe(true);
    expect(existsSync(join(TMP, "server.ts"))).toBe(true);
    expect(existsSync(join(TMP, "manifest.json"))).toBe(true);
  });

  it("downloads CSS and its sub-assets (fonts, images)", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    await c.run();

    const files = await listRecursive(join(TMP, "assets"));
    const names = files.map((f) => f.split("/").pop());
    expect(names).toContain("style.css");
    expect(names).toContain("font.woff2");
    expect(names).toContain("bg.jpg");
  });

  it("downloads internal pages", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 5 });
    const result = await c.run();

    expect(existsSync(join(TMP, "pages", "about.html"))).toBe(true);
    expect(result.ok).toBeGreaterThan(5);
  });

  it("rewrites paths in HTML", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    await c.run();

    const html = await Bun.file(join(TMP, "index.html")).text();
    expect(html).not.toContain(`href="/style.css"`);
    expect(html).toContain("assets/css/style.css");
    expect(html).not.toContain(`src="/app.js"`);
    expect(html).toContain("assets/js/app.js");
  });

  it("rewrites paths in CSS", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    await c.run();

    const css = await Bun.file(join(TMP, "assets", "css", "style.css")).text();
    expect(css).not.toContain("url(/bg.jpg)");
    expect(css).not.toContain("url(/font.woff2)");
    expect(css).toContain("../images/bg.jpg");
    expect(css).toContain("../fonts/font.woff2");
  });

  it("respects --pages 0", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    await c.run();

    expect(existsSync(join(TMP, "pages", "about.html"))).toBe(false);
  });

  it("returns CloneResult with stats", async () => {
    const c = new Cloner(`http://localhost:${port}`, TMP, { pages: 0 });
    const result = await c.run();

    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("elapsed");
    expect(result).toHaveProperty("records");
    expect(result.records).toBeInstanceOf(Map);
  });

  it("throws on unreachable URL", async () => {
    const c = new Cloner("http://127.0.0.1:1", TMP, { pages: 0 });
    await expect(c.run()).rejects.toThrow("Failed to fetch homepage");
  });
});

async function listRecursive(dir: string): Promise<string[]> {
  const { readdirSync, statSync } = require("node:fs");
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) results.push(...(await listRecursive(full)));
      else results.push(full);
    }
  } catch {}
  return results;
}
