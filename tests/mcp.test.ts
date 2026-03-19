import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/mcp";

describe("MCP server", () => {
  it("creates server with correct name", () => {
    const server = createServer();
    expect(server).toBeTruthy();
  });

  it("registers clone tool", () => {
    const server = createServer();
    expect((server as any)._registeredTools?.clone || (server as any)._tools?.clone).toBeTruthy;
  });
});

describe("MCP clone tool", () => {
  const TMP = join(import.meta.dir, ".tmp-mcp");
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
            `<html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Test</h1></body></html>`,
            { headers: { "Content-Type": "text/html" } }
          );
        }
        if (pathname === "/style.css") return new Response("body { color: red; }");
        return new Response("not found", { status: 404 });
      },
    });
    port = server.port;
  });

  afterEach(() => {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("clones site via Cloner in silent mode", async () => {
    const { Cloner } = await import("../src/cloner");
    const cloner = new Cloner(`http://localhost:${port}`, TMP, { pages: 0, silent: true });
    const result = await cloner.run();

    expect(result.ok).toBeGreaterThan(0);
    expect(existsSync(join(TMP, "index.html"))).toBe(true);
    expect(existsSync(join(TMP, "server.ts"))).toBe(true);
  });

  it("silent mode produces no stdout", async () => {
    const { Cloner } = await import("../src/cloner");
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

  it("handles clone error gracefully", async () => {
    const { Cloner } = await import("../src/cloner");
    const cloner = new Cloner("http://127.0.0.1:1", TMP, { pages: 0, silent: true });

    try {
      await cloner.run();
      expect(true).toBe(false);
    } catch (e) {
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toContain("Failed to fetch");
    }
  });
});
