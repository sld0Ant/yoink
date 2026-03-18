import { describe, it, expect } from "bun:test";
import { parseArgs } from "../src/cli";

function parse(...args: string[]) {
  return parseArgs(["bun", "index.ts", ...args]);
}

describe("parseArgs", () => {
  it("parses url and dir", () => {
    const r = parse("https://example.com", "my-site");
    expect(r.url).toBe("https://example.com");
    expect(r.dir).toBe("my-site");
  });

  it("defaults dir to cloned-site", () => {
    expect(parse("https://example.com").dir).toBe("cloned-site");
  });

  it("parses --pages", () => {
    expect(parse("https://example.com", "--pages", "5").opts.pages).toBe(5);
  });

  it("parses --images", () => {
    expect(parse("https://example.com", "--images", "0").opts.images).toBe(0);
  });

  it("parses --no-cdn", () => {
    expect(parse("https://example.com", "--no-cdn").opts.noCdn).toBe(true);
  });

  it("parses --concurrency", () => {
    expect(parse("https://example.com", "--concurrency", "16").opts.concurrency).toBe(16);
  });

  it("parses -b cookie", () => {
    expect(parse("https://example.com", "-b", "device=desktop").opts.cookie).toBe("device=desktop");
  });

  it("parses -H header", () => {
    expect(parse("https://example.com", "-H", "Accept-Language: ru").opts.headers).toEqual({ "Accept-Language": "ru" });
  });

  it("parses multiple headers", () => {
    expect(parse("https://example.com", "-H", "X-A: 1", "-H", "X-B: 2").opts.headers).toEqual({ "X-A": "1", "X-B": "2" });
  });
});
