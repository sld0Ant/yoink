import { describe, it, expect, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Fetcher } from "../src/fetcher";

const TMP = join(import.meta.dir, ".tmp-fetcher");

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("Fetcher", () => {
  it("sends custom headers", async () => {
    let receivedHeaders: Record<string, string> = {};
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        return new Response("ok");
      },
    });

    const f = new Fetcher({ Cookie: "session=abc", "X-Custom": "test" });
    await f.text(`http://localhost:${server.port}/`);

    expect(receivedHeaders["cookie"]).toBe("session=abc");
    expect(receivedHeaders["x-custom"]).toBe("test");
    expect(receivedHeaders["user-agent"]).toContain("Chrome");

    server.stop();
  });

  it("text() returns string on 200", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html>hello</html>");
      },
    });

    const f = new Fetcher();
    const result = await f.text(`http://localhost:${server.port}/`);
    expect(result).toBe("<html>hello</html>");

    server.stop();
  });

  it("text() returns null on 404", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 404 });
      },
    });

    const f = new Fetcher();
    const result = await f.text(`http://localhost:${server.port}/`);
    expect(result).toBeNull();

    server.stop();
  });

  it("text() returns null on network error", async () => {
    const f = new Fetcher();
    const result = await f.text("http://127.0.0.1:1/nope");
    expect(result).toBeNull();
  });

  it("binary() writes file and returns byte count", async () => {
    const body = Buffer.alloc(1024, 0xff);
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(body);
      },
    });

    const { mkdirSync } = require("node:fs");
    mkdirSync(TMP, { recursive: true });
    const dest = join(TMP, "out.bin");

    const f = new Fetcher();
    const bytes = await f.binary(`http://localhost:${server.port}/`, dest);
    expect(bytes).toBe(1024);

    const written = await Bun.file(dest).arrayBuffer();
    expect(written.byteLength).toBe(1024);

    server.stop();
  });

  it("binary() returns -1 on failure", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("no", { status: 500 });
      },
    });

    const f = new Fetcher();
    const bytes = await f.binary(`http://localhost:${server.port}/`, "/tmp/nope.bin");
    expect(bytes).toBe(-1);

    server.stop();
  });
});
