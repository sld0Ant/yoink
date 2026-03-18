import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Namer } from "../src/namer";

const TMP = join(import.meta.dir, ".tmp-namer");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("Namer.alloc", () => {
  it("extracts filename from URL", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://example.com/static/app.js", "assets/js")).toBe("assets/js/app.js");
  });

  it("strips query string from filename", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://example.com/font.woff2?v=123", "assets/fonts")).toBe("assets/fonts/font.woff2");
  });

  it("adds extension for css dir when missing", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://example.com/style", "assets/css")).toBe("assets/css/style.css");
  });

  it("adds extension for js dir when missing", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://example.com/bundle", "assets/js")).toBe("assets/js/bundle.js");
  });

  it("adds extension for font dir when missing", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://example.com/myfont", "assets/fonts")).toBe("assets/fonts/myfont.woff2");
  });

  it("handles collision with numeric suffix", () => {
    const n = new Namer(TMP);
    expect(n.alloc("https://a.com/logo.png", "assets/images")).toBe("assets/images/logo.png");
    expect(n.alloc("https://b.com/logo.png", "assets/images")).toBe("assets/images/logo-1.png");
    expect(n.alloc("https://c.com/logo.png", "assets/images")).toBe("assets/images/logo-2.png");
  });

  it("handles URLs with no path", () => {
    const n = new Namer(TMP);
    const result = n.alloc("https://example.com/", "assets/images");
    expect(result).toMatch(/^assets\/images\/file/);
  });

  it("handles invalid URLs gracefully", () => {
    const n = new Namer(TMP);
    const result = n.alloc("not-a-url", "assets/images");
    expect(result).toMatch(/^assets\/images\//);
  });

  it("creates directory on disk", () => {
    const n = new Namer(TMP);
    n.alloc("https://example.com/a.png", "assets/deep/nested");
    const { existsSync } = require("node:fs");
    expect(existsSync(join(TMP, "assets/deep/nested"))).toBe(true);
  });
});

describe("Namer.pageSlug", () => {
  it("converts path to slug", () => {
    const n = new Namer(TMP);
    expect(n.pageSlug("https://example.com/about/team")).toBe("about-team.html");
  });

  it("handles root path", () => {
    const n = new Namer(TMP);
    expect(n.pageSlug("https://example.com/")).toBe("page.html");
  });

  it("preserves .html extension", () => {
    const n = new Namer(TMP);
    expect(n.pageSlug("https://example.com/page.html")).toBe("page.html");
  });

  it("handles deeply nested paths", () => {
    const n = new Namer(TMP);
    expect(n.pageSlug("https://example.com/a/b/c/d")).toBe("a-b-c-d.html");
  });

  it("handles invalid URL", () => {
    const n = new Namer(TMP);
    expect(n.pageSlug("garbage")).toBe("page.html");
  });
});
