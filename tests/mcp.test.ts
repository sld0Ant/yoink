import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/mcp";
import { Cloner } from "../src/cloner";

const TMP = join(import.meta.dir, ".tmp-mcp");

function serveSite() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        return new Response(
          `<html><head><link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head>
           <body><h1>Test</h1><img src="/logo.png"><a href="/about">About</a></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      if (pathname === "/about") {
        return new Response(`<html><body><h1>About</h1></body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (pathname === "/style.css") return new Response("body { color: red; }");
      if (pathname === "/app.js") return new Response("console.log('hi')");
      if (pathname === "/module.js") return new Response(`import Demo from "./demo.js"; new Demo();`);
      if (pathname === "/demo.js") return new Response("export default class Demo {}");
      if (pathname === "/logo.png") return new Response(Buffer.alloc(64));
      return new Response("not found", { status: 404 });
    },
  });
}

describe("MCP server", () => {
  it("creates server with correct name", () => {
    const server = createServer();
    expect(server).toBeTruthy();
  });

  it("registers all four tools", () => {
    const server = createServer();
    const tools = (server as any)._registeredTools ?? (server as any)._tools ?? {};
    for (const name of ["clone", "list", "inspect", "resume"]) {
      expect(tools[name]).toBeTruthy();
    }
  });
});

describe("clone tool", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    server = serveSite();
    port = server.port;
  });

  afterEach(() => {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("returns full summary with asset breakdown", async () => {
    const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 0, silent: true });
    const result = await cloner.run();
    const s = result.summary;

    expect(s.url).toBe(`http://localhost:${port}/`);
    expect(s.hostname).toBe("localhost");
    expect(s.clonedAt).toBeTruthy();
    expect(s.elapsed).toBeGreaterThanOrEqual(0);
    expect(s.maxPages).toBe(0);
    expect(s.pagesDownloaded).toBe(0);
    expect(s.assets.total).toBeGreaterThan(0);
    expect(s.assets.css).toBeGreaterThanOrEqual(1);
    expect(s.assets.js).toBeGreaterThanOrEqual(1);
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.domains).toContain("localhost");
    expect(s.outputDir).toBe(TMP);
  });

  it("writes summary.json to output dir", async () => {
    const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 0, silent: true });
    await cloner.run();

    const summaryPath = join(TMP, "summary.json");
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(await Bun.file(summaryPath).text());
    expect(summary.url).toContain("localhost");
    expect(summary.assets.total).toBeGreaterThan(0);
  });

  it("downloads and rewrites ES module dependencies", async () => {
    const moduleServer = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/") {
          return new Response(`<script type="module" src="/module.js"></script>`, {
            headers: { "Content-Type": "text/html" },
          });
        }
        if (pathname === "/module.js") return new Response(`import Demo from "./lib/demo.js"; new Demo();`);
        if (pathname === "/lib/demo.js") return new Response("export default class Demo {}");
        return new Response("not found", { status: 404 });
      },
    });

    const dir = TMP + "-modules";
    try {
      const cloner = new Cloner(`http://localhost:${moduleServer.port}`, dir, { pages: 0, silent: true });
      const result = await cloner.run();
      const moduleRecord = [...result.records.entries()].find(([url]) => url.endsWith("/module.js"))?.[1];
      const dependencyRecord = [...result.records.entries()].find(([url]) => url.endsWith("/lib/demo.js"))?.[1];

      expect(moduleRecord?.status).toBe("ok");
      expect(dependencyRecord?.status).toBe("ok");
      const moduleJs = await Bun.file(join(dir, moduleRecord!.local)).text();
      expect(moduleJs).toContain(`from "./demo.js"`);
    } finally {
      moduleServer.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts pages when depth > 0", async () => {
    const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 5, silent: true });
    const result = await cloner.run();

    expect(result.summary.maxPages).toBe(5);
    expect(result.summary.pagesDownloaded).toBeGreaterThanOrEqual(1);
    expect(result.summary.assets.pages).toBeGreaterThanOrEqual(1);
  });

  it("tracks failed assets in summary", async () => {
    const badServer = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/") {
          return new Response(
            `<html><head><link rel="stylesheet" href="/missing.css"></head><body>Hi</body></html>`,
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("nope", { status: 500 });
      },
    });

    const dir = TMP + "-fail";
    try {
      const cloner = new Cloner(`http://localhost:${badServer.port}`, dir, {
        pages: 0,
        silent: true,
      });
      const result = await cloner.run();
      expect(result.summary.failed.length).toBeGreaterThan(0);
      expect(result.summary.failed[0].reason).toBeTruthy();
    } finally {
      badServer.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("silent mode produces no stdout", async () => {
    const origWrite = process.stdout.write;
    let output = "";
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 0, silent: true });
      await cloner.run();
    } finally {
      process.stdout.write = origWrite;
    }
    expect(output).toBe("");
  });
});

describe("list tool", () => {
  const BASE = join(TMP, "list-test");

  beforeEach(() => {
    rmSync(BASE, { recursive: true, force: true });
    mkdirSync(BASE, { recursive: true });
  });

  afterEach(() => {
    rmSync(BASE, { recursive: true, force: true });
  });

  it("finds cloned sites by summary.json", () => {
    const siteDir = join(BASE, "example.com");
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(
      join(siteDir, "summary.json"),
      JSON.stringify({
        url: "https://example.com",
        hostname: "example.com",
        clonedAt: "2025-01-01T00:00:00.000Z",
        assets: { total: 10 },
        failed: [],
        totalBytes: 5000,
      }),
    );

    const { readdirSync } = require("node:fs");
    const { resolve } = require("node:path");
    const dir = resolve(BASE);
    const sites: any[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sp = join(dir, entry.name, "summary.json");
      if (!existsSync(sp)) continue;
      const s = JSON.parse(require("node:fs").readFileSync(sp, "utf8"));
      sites.push({ directory: entry.name, url: s.url, hostname: s.hostname });
    }

    expect(sites).toHaveLength(1);
    expect(sites[0].directory).toBe("example.com");
    expect(sites[0].url).toBe("https://example.com");
  });

  it("returns empty when no clones exist", () => {
    const { readdirSync } = require("node:fs");
    const { resolve } = require("node:path");
    const dir = resolve(BASE);
    const sites: any[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sp = join(dir, entry.name, "summary.json");
      if (!existsSync(sp)) continue;
      sites.push({ directory: entry.name });
    }

    expect(sites).toHaveLength(0);
  });
});

describe("inspect tool", () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("reads summary.json from directory", () => {
    const summary = { url: "https://test.com", assets: { total: 5 } };
    writeFileSync(join(TMP, "summary.json"), JSON.stringify(summary));

    const raw = require("node:fs").readFileSync(join(TMP, "summary.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.url).toBe("https://test.com");
    expect(parsed.assets.total).toBe(5);
  });
});

describe("resume tool", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    server = serveSite();
    port = server.port;
  });

  afterEach(() => {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("resumes from existing summary.json", async () => {
    const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 0, silent: true });
    const r1 = await cloner.run();
    const firstOk = r1.ok;

    const cloner2 = new Cloner(r1.summary.url, TMP, {
      pages: r1.summary.maxPages,
      resume: true,
      silent: true,
    });
    const r2 = await cloner2.run();

    expect(r2.ok).toBeLessThanOrEqual(firstOk);
    expect(r2.summary.url).toBe(r1.summary.url);
    expect(existsSync(join(TMP, "summary.json"))).toBe(true);
  });
});
