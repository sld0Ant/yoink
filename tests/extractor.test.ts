import { describe, it, expect } from "bun:test";
import { extractHtmlAssets, extractCssAssets, extractInternalLinks, normalizeUrl } from "../src/extractor";

describe("extractHtmlAssets", () => {
  const base = "https://example.com/page";

  it("extracts stylesheets", () => {
    const html = `<link rel="stylesheet" href="/style.css">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.css).toEqual(["https://example.com/style.css"]);
  });

  it("extracts stylesheets with reversed attr order", () => {
    const html = `<link href="/style.css" rel="stylesheet">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.css).toContain("https://example.com/style.css");
  });

  it("extracts scripts", () => {
    const html = `<script src="/app.js"></script>`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.js).toEqual(["https://example.com/app.js"]);
  });

  it("extracts images", () => {
    const html = `<img src="/photo.jpg">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://example.com/photo.jpg");
  });

  it("ignores data URIs in images", () => {
    const html = `<img src="data:image/png;base64,abc">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toEqual([]);
  });

  it("extracts srcset entries", () => {
    const html = `<img srcset="/small.jpg 1x, /large.jpg 2x">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://example.com/small.jpg");
    expect(assets.images).toContain("https://example.com/large.jpg");
  });

  it("extracts picture source srcset", () => {
    const html = `<source srcset="/wide.avif 1x, /wider.avif 2x">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://example.com/wide.avif");
    expect(assets.images).toContain("https://example.com/wider.avif");
  });

  it("extracts og:image", () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/og.png">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://cdn.example.com/og.png");
  });

  it("extracts og:image with reversed attr order", () => {
    const html = `<meta content="https://cdn.example.com/og.png" property="og:image">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://cdn.example.com/og.png");
  });

  it("extracts icons", () => {
    const html = `<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple.png">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.icons).toContain("https://example.com/favicon.ico");
    expect(assets.icons).toContain("https://example.com/apple.png");
  });

  it("extracts inline url() as images", () => {
    const html = `<div style="background: url(/bg.png)"></div>`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images).toContain("https://example.com/bg.png");
  });

  it("extracts inline url() fonts", () => {
    const html = `<style>@font-face { src: url(/font.woff2) }</style>`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.fonts).toContain("https://example.com/font.woff2");
  });

  it("resolves relative URLs", () => {
    const html = `<script src="lib/app.js"></script>`;
    const assets = extractHtmlAssets(html, "https://example.com/dir/index.html");
    expect(assets.js).toContain("https://example.com/dir/lib/app.js");
  });

  it("resolves protocol-relative URLs", () => {
    const html = `<script src="//cdn.example.com/lib.js"></script>`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.js).toContain("https://cdn.example.com/lib.js");
  });

  it("deduplicates", () => {
    const html = `<img src="/a.jpg"><img src="/a.jpg">`;
    const assets = extractHtmlAssets(html, base);
    expect(assets.images.filter((u) => u === "https://example.com/a.jpg")).toHaveLength(1);
  });
});

describe("extractCssAssets", () => {
  const base = "https://example.com/static/style.css";

  it("extracts @import url()", () => {
    const css = `@import url("/other.css");`;
    const result = extractCssAssets(css, base);
    expect(result.css).toContain("https://example.com/other.css");
  });

  it("extracts @import string", () => {
    const css = `@import "/other.css";`;
    const result = extractCssAssets(css, base);
    expect(result.css).toContain("https://example.com/other.css");
  });

  it("extracts font url()", () => {
    const css = `@font-face { src: url(/fonts/roboto.woff2) format("woff2"); }`;
    const result = extractCssAssets(css, base);
    expect(result.fonts).toContain("https://example.com/fonts/roboto.woff2");
  });

  it("extracts background-image url()", () => {
    const css = `.hero { background-image: url(/img/bg.jpg); }`;
    const result = extractCssAssets(css, base);
    expect(result.images).toContain("https://example.com/img/bg.jpg");
  });

  it("ignores data URIs", () => {
    const css = `.icon { background: url(data:image/svg+xml;base64,abc); }`;
    const result = extractCssAssets(css, base);
    expect(result.images).toEqual([]);
    expect(result.fonts).toEqual([]);
  });

  it("ignores hash references", () => {
    const css = `.icon { filter: url(#blur); }`;
    const result = extractCssAssets(css, base);
    expect(result.images).toEqual([]);
  });

  it("resolves relative to CSS file", () => {
    const css = `@font-face { src: url(../fonts/a.woff2); }`;
    const result = extractCssAssets(css, base);
    expect(result.fonts).toContain("https://example.com/fonts/a.woff2");
  });

  it("deduplicates", () => {
    const css = `.a { background: url(/x.png); } .b { background: url(/x.png); }`;
    const result = extractCssAssets(css, base);
    expect(result.images).toHaveLength(1);
  });
});

describe("extractInternalLinks", () => {
  const origin = "https://example.com";
  const home = "https://example.com/";

  it("extracts same-origin links", () => {
    const html = `<a href="/about">About</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toContain("https://example.com/about");
  });

  it("ignores external links", () => {
    const html = `<a href="https://other.com/page">Other</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toEqual([]);
  });

  it("ignores mailto/tel/javascript", () => {
    const html = `<a href="mailto:x@y.com">M</a><a href="tel:123">T</a><a href="javascript:void(0)">J</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toEqual([]);
  });

  it("ignores file extensions (pdf, zip, etc.)", () => {
    const html = `<a href="/file.pdf">PDF</a><a href="/arch.zip">ZIP</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toEqual([]);
  });

  it("excludes homepage itself", () => {
    const html = `<a href="/">Home</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toEqual([]);
  });

  it("deduplicates", () => {
    const html = `<a href="/about">A</a><a href="/about">B</a>`;
    const links = extractInternalLinks(html, home, origin, home);
    expect(links).toHaveLength(1);
  });
});

describe("normalizeUrl", () => {
  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/about/")).toBe("https://example.com/about");
  });

  it("keeps root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("removes fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("sorts query params", () => {
    expect(normalizeUrl("https://example.com/page?z=1&a=2")).toBe("https://example.com/page?a=2&z=1");
  });

  it("handles URL without query or fragment", () => {
    expect(normalizeUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("returns input for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });

  it("normalizes combined trailing slash + fragment + query", () => {
    expect(normalizeUrl("https://example.com/about/?b=2&a=1#top")).toBe("https://example.com/about?a=1&b=2");
  });
});
