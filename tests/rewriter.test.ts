import { describe, it, expect } from "bun:test";
import { rewriteHtml, rewriteCss, rewriteJs } from "../src/rewriter";

describe("rewriteHtml", () => {
  const origin = "https://example.com";

  it("rewrites absolute URLs to local paths", () => {
    const map = new Map([["https://example.com/style.css", "assets/css/style.css"]]);
    const html = `<link href="https://example.com/style.css" rel="stylesheet">`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toContain('href="assets/css/style.css"');
  });

  it("rewrites pathname-only references", () => {
    const map = new Map([["https://example.com/app.js", "assets/js/app.js"]]);
    const html = `<script src="/app.js"></script>`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toContain('src="assets/js/app.js"');
  });

  it("adds ../ prefix for nested depth", () => {
    const map = new Map([["https://example.com/style.css", "assets/css/style.css"]]);
    const html = `<link href="https://example.com/style.css">`;
    const result = rewriteHtml(html, origin, map, 1);
    expect(result).toContain('href="../assets/css/style.css"');
  });

  it("adds ../../ prefix for depth 2", () => {
    const map = new Map([["https://example.com/a.js", "assets/js/a.js"]]);
    const html = `<script src="https://example.com/a.js"></script>`;
    const result = rewriteHtml(html, origin, map, 2);
    expect(result).toContain('src="../../assets/js/a.js"');
  });

  it("rewrites pathname+search", () => {
    const map = new Map([["https://example.com/img.png?v=1", "assets/images/img.png"]]);
    const html = `<img src="/img.png?v=1">`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toContain('src="assets/images/img.png"');
  });

  it("replaces longer URLs first to avoid partial matches", () => {
    const map = new Map([
      ["https://example.com/static/js/app.js", "assets/js/app.js"],
      ["https://example.com/static/js/", "assets/js/"],
    ]);
    const html = `<script src="https://example.com/static/js/app.js"></script>`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toContain('src="assets/js/app.js"');
  });

  it("does not touch URLs not in assetMap", () => {
    const map = new Map<string, string>();
    const html = `<a href="https://other.com/page">Link</a>`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toBe(html);
  });

  it("rewrites cross-origin CDN URLs", () => {
    const map = new Map([["https://cdn.example.com/lib.js", "assets/js/lib.js"]]);
    const html = `<script src="https://cdn.example.com/lib.js"></script>`;
    const result = rewriteHtml(html, origin, map, 0);
    expect(result).toContain('src="assets/js/lib.js"');
  });
});

describe("rewriteCss", () => {
  it("rewrites absolute URLs to relative paths", () => {
    const map = new Map([["https://example.com/fonts/a.woff2", "assets/fonts/a.woff2"]]);
    const css = `@font-face { src: url(https://example.com/fonts/a.woff2); }`;
    const result = rewriteCss(css, "style.css", undefined, map);
    expect(result).toContain("url(../fonts/a.woff2)");
  });

  it("rewrites pathname references", () => {
    const map = new Map([["https://example.com/img/bg.png", "assets/images/bg.png"]]);
    const css = `.hero { background: url(/img/bg.png); }`;
    const result = rewriteCss(css, "style.css", "https://example.com/css/style.css", map);
    expect(result).toContain("url(../images/bg.png)");
  });

  it("strips query strings from rewritten url() paths", () => {
    const map = new Map([["https://example.com/font.woff2?v=abc", "assets/fonts/font.woff2"]]);
    const css = `@font-face { src: url(/font.woff2?v=abc); }`;
    const result = rewriteCss(css, "style.css", "https://example.com/css/style.css", map);
    expect(result).not.toContain("?v=abc");
    expect(result).toContain("url(../fonts/font.woff2)");
  });

  it("handles pathname+search replacement", () => {
    const map = new Map([["https://cdn.example.com/static/fonts/Roboto.woff2?hash=123", "assets/fonts/Roboto.woff2"]]);
    const css = `@font-face { src: url(/static/fonts/Roboto.woff2?hash=123); }`;
    const result = rewriteCss(css, "out.css", "https://cdn.example.com/css/out.css", map);
    expect(result).toContain("url(../fonts/Roboto.woff2)");
    expect(result).not.toContain("?hash=123");
  });

  it("rewrites pathname from cssOrigUrl context", () => {
    const map = new Map([["https://example.com/static/img/icon.svg", "assets/images/icon.svg"]]);
    const css = `.icon { background: url(/static/img/icon.svg); }`;
    const result = rewriteCss(css, "style.css", "https://example.com/static/css/style.css", map);
    expect(result).toContain("../images/icon.svg");
  });

  it("does not touch data URIs", () => {
    const map = new Map<string, string>();
    const css = `.icon { background: url(data:image/svg+xml;base64,abc); }`;
    const result = rewriteCss(css, "style.css", undefined, map);
    expect(result).toBe(css);
  });
});

describe("rewriteJs", () => {
  it("rewrites module URLs relative to the downloaded JS file", () => {
    const js = `import Demo from "https://example.com/demos/js/demo.js";`;
    const map = new Map([
      ["https://example.com/demos/js/demo.js", "assets/js/demo.js"],
    ]);

    expect(rewriteJs(js, "main.js", "https://example.com/demos/main.js", map)).toBe(`import Demo from "./demo.js";`);
  });
});
