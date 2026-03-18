import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, mkdirSync } from "node:fs";
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

    const f = new Fetcher({ headers: { Cookie: "session=abc", "X-Custom": "test" } });
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
    const f = new Fetcher({ retries: 0 });
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

    mkdirSync(TMP, { recursive: true });
    const dest = join(TMP, "out.bin");

    const f = new Fetcher();
    const result = await f.binary(`http://localhost:${server.port}/`, dest);
    expect(result.bytes).toBe(1024);
    expect(result.error).toBeUndefined();

    const written = await Bun.file(dest).arrayBuffer();
    expect(written.byteLength).toBe(1024);

    server.stop();
  });

  it("binary() returns error on failure", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("no", { status: 500 });
      },
    });

    const f = new Fetcher({ retries: 0 });
    const result = await f.binary(`http://localhost:${server.port}/`, "/tmp/nope.bin");
    expect(result.bytes).toBe(-1);
    expect(result.error).toBe("http:500");

    server.stop();
  });

  it("retries on 503 then succeeds", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        if (attempts <= 2) return new Response("busy", { status: 503 });
        return new Response("ok");
      },
    });

    const f = new Fetcher({ retries: 3, retryDelay: 10 });
    const result = await f.text(`http://localhost:${server.port}/`);
    expect(result).toBe("ok");
    expect(attempts).toBe(3);

    server.stop();
  });

  it("does not retry on 404", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response("nope", { status: 404 });
      },
    });

    const f = new Fetcher({ retries: 3, retryDelay: 10 });
    const result = await f.text(`http://localhost:${server.port}/`);
    expect(result).toBeNull();
    expect(attempts).toBe(1);

    server.stop();
  });

  it("does not retry on 403", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response("forbidden", { status: 403 });
      },
    });

    const f = new Fetcher({ retries: 3, retryDelay: 10 });
    const result = await f.text(`http://localhost:${server.port}/`);
    expect(result).toBeNull();
    expect(attempts).toBe(1);

    server.stop();
  });

  it("calls onError with classified reason", async () => {
    const errors: [string, string][] = [];
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("forbidden", { status: 403 });
      },
    });

    const f = new Fetcher({
      retries: 0,
      onError: (url, reason) => errors.push([url, reason]),
    });
    await f.text(`http://localhost:${server.port}/test`);

    expect(errors.length).toBe(1);
    expect(errors[0][0]).toContain("/test");
    expect(errors[0][1]).toBe("http:403");

    server.stop();
  });

  it("calls onError on network failure", async () => {
    const errors: [string, string][] = [];
    const f = new Fetcher({
      retries: 0,
      onError: (url, reason) => errors.push([url, reason]),
    });
    await f.text("http://127.0.0.1:1/nope");

    expect(errors.length).toBe(1);
    expect(errors[0][1]).toBe("network");
  });

  it("retries binary on 503 then succeeds", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        if (attempts <= 1) return new Response("busy", { status: 503 });
        return new Response(Buffer.alloc(16));
      },
    });

    mkdirSync(TMP, { recursive: true });
    const dest = join(TMP, "retry.bin");

    const f = new Fetcher({ retries: 2, retryDelay: 10 });
    const result = await f.binary(`http://localhost:${server.port}/`, dest);
    expect(result.bytes).toBe(16);
    expect(attempts).toBe(2);

    server.stop();
  });
});
