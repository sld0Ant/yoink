import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { inlineScripts, inlineStyles } from "../src/inliner";

const TMP = join(import.meta.dir, ".tmp-inliner");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "assets/js"), { recursive: true });
  mkdirSync(join(TMP, "assets/css"), { recursive: true });
});
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("inlineScripts", () => {
  it("replaces script src with inline content", async () => {
    await Bun.write(join(TMP, "assets/js/app.js"), "console.log('hello')");
    const html = `<html><script src="assets/js/app.js"></script></html>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toContain("<script>console.log('hello')</script>");
    expect(result).not.toContain('src="assets/js/app.js"');
  });

  it("removes defer/async attributes", async () => {
    await Bun.write(join(TMP, "assets/js/app.js"), "void 0");
    const html = `<script defer src="assets/js/app.js"></script>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toContain("<script>void 0</script>");
    expect(result).not.toContain("defer");
  });

  it("skips external URLs", async () => {
    const html = `<script src="https://cdn.example.com/lib.js"></script>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toBe(html);
  });

  it("skips protocol-relative URLs", async () => {
    const html = `<script src="//cdn.example.com/lib.js"></script>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toBe(html);
  });

  it("leaves tag unchanged if file missing", async () => {
    const html = `<script src="assets/js/missing.js"></script>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toBe(html);
  });

  it("handles multiple scripts", async () => {
    await Bun.write(join(TMP, "assets/js/a.js"), "var a=1");
    await Bun.write(join(TMP, "assets/js/b.js"), "var b=2");
    const html = `<script src="assets/js/a.js"></script><script src="assets/js/b.js"></script>`;
    const result = await inlineScripts(html, TMP);
    expect(result).toContain("<script>var a=1</script>");
    expect(result).toContain("<script>var b=2</script>");
  });
});

describe("inlineStyles", () => {
  it("replaces link stylesheet with inline style", async () => {
    await Bun.write(join(TMP, "assets/css/style.css"), "body { color: red; }");
    const html = `<html><link rel="stylesheet" href="assets/css/style.css"></html>`;
    const result = await inlineStyles(html, TMP);
    expect(result).toContain("<style>body { color: red; }</style>");
    expect(result).not.toContain('href="assets/css/style.css"');
  });

  it("handles reversed attr order", async () => {
    await Bun.write(join(TMP, "assets/css/style.css"), ".x{margin:0}");
    const html = `<link href="assets/css/style.css" rel="stylesheet">`;
    const result = await inlineStyles(html, TMP);
    expect(result).toContain("<style>.x{margin:0}</style>");
  });

  it("skips external URLs", async () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/style.css">`;
    const result = await inlineStyles(html, TMP);
    expect(result).toBe(html);
  });

  it("leaves tag unchanged if file missing", async () => {
    const html = `<link rel="stylesheet" href="assets/css/missing.css">`;
    const result = await inlineStyles(html, TMP);
    expect(result).toBe(html);
  });

  it("handles multiple stylesheets", async () => {
    await Bun.write(join(TMP, "assets/css/a.css"), ".a{}");
    await Bun.write(join(TMP, "assets/css/b.css"), ".b{}");
    const html = `<link rel="stylesheet" href="assets/css/a.css"><link rel="stylesheet" href="assets/css/b.css">`;
    const result = await inlineStyles(html, TMP);
    expect(result).toContain("<style>.a{}</style>");
    expect(result).toContain("<style>.b{}</style>");
  });
});
