import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Downloader } from "../src/downloader";
import { Fetcher } from "../src/fetcher";
import { Namer } from "../src/namer";
import { SilentProgress } from "../src/progress";
import type { Assets } from "../src/types";

const TMP = join(import.meta.dir, ".tmp-dl");
let server: ReturnType<typeof Bun.serve>;
let port: number;

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/style.css") return new Response("body { color: red; }");
      if (pathname === "/app.js") return new Response("console.log('hi')");
      if (pathname === "/logo.png") return new Response(Buffer.alloc(64, 0xab));
      if (pathname === "/font.woff2") return new Response(Buffer.alloc(32, 0xcd));
      if (pathname === "/favicon.ico") return new Response(Buffer.alloc(16, 0xef));
      if (pathname === "/fail") return new Response("no", { status: 500 });
      return new Response("not found", { status: 404 });
    },
  });
  port = server.port;
});

afterEach(() => {
  server.stop();
  rmSync(TMP, { recursive: true, force: true });
});

function makeDl(opts: { maxImages?: number; skipCdn?: boolean } = {}) {
  const fetcher = new Fetcher();
  const namer = new Namer(TMP);
  const progress = new SilentProgress();
  return new Downloader(fetcher, namer, progress, TMP, opts.maxImages ?? 200, opts.skipCdn ?? false, "localhost", 4);
}

function assets(partial: Partial<Assets> = {}): Assets {
  return { css: [], js: [], images: [], fonts: [], icons: [], ...partial };
}

describe("Downloader", () => {
  it("downloads CSS files", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ css: [`http://localhost:${port}/style.css`] }));

    expect(dl.records.size).toBe(1);
    const rec = dl.records.get(`http://localhost:${port}/style.css`);
    expect(rec?.status).toBe("ok");
    expect(existsSync(join(TMP, rec!.local))).toBe(true);

    const content = await Bun.file(join(TMP, rec!.local)).text();
    expect(content).toContain("color: red");
  });

  it("downloads JS files", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ js: [`http://localhost:${port}/app.js`] }));

    const rec = dl.records.get(`http://localhost:${port}/app.js`);
    expect(rec?.status).toBe("ok");
  });

  it("downloads images", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ images: [`http://localhost:${port}/logo.png`] }));

    const rec = dl.records.get(`http://localhost:${port}/logo.png`);
    expect(rec?.status).toBe("ok");

    const buf = await Bun.file(join(TMP, rec!.local)).arrayBuffer();
    expect(buf.byteLength).toBe(64);
  });

  it("downloads fonts", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ fonts: [`http://localhost:${port}/font.woff2`] }));

    const rec = dl.records.get(`http://localhost:${port}/font.woff2`);
    expect(rec?.status).toBe("ok");
  });

  it("downloads icons", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ icons: [`http://localhost:${port}/favicon.ico`] }));

    const rec = dl.records.get(`http://localhost:${port}/favicon.ico`);
    expect(rec?.status).toBe("ok");
  });

  it("records failed downloads", async () => {
    const dl = makeDl();
    await dl.downloadAssets(assets({ js: [`http://localhost:${port}/fail`] }));

    const rec = dl.records.get(`http://localhost:${port}/fail`);
    expect(rec?.status).toBe("failed");
    expect(dl.failures).toContain(`http://localhost:${port}/fail`);
  });

  it("deduplicates same URL", async () => {
    const dl = makeDl();
    const url = `http://localhost:${port}/app.js`;
    await dl.downloadAssets(assets({ js: [url] }));
    await dl.downloadAssets(assets({ js: [url] }));

    expect(dl.records.size).toBe(1);
  });

  it("respects image limit", async () => {
    const dl = makeDl({ maxImages: 1 });
    await dl.downloadAssets(
      assets({
        images: [`http://localhost:${port}/logo.png`, `http://localhost:${port}/font.woff2`],
      })
    );

    const downloaded = [...dl.records.values()].filter((r) => r.status === "ok");
    expect(downloaded.length).toBe(1);
  });

  it("populates assetMap and reverse index", async () => {
    const dl = makeDl();
    const url = `http://localhost:${port}/app.js`;
    await dl.downloadAssets(assets({ js: [url] }));

    const local = dl.assetMap.get(url);
    expect(local).toBeTruthy();
    expect(dl.findUrlByLocal(local!)).toBe(url);
  });

  it("downloads page and maps it", async () => {
    const dl = makeDl();
    const url = "https://example.com/about";
    await dl.downloadPage(url, "about.html", "<html>about</html>");

    expect(dl.assetMap.get(url)).toBe("pages/about.html");
    expect(dl.findUrlByLocal("pages/about.html")).toBe(url);

    const content = await Bun.file(join(TMP, "pages", "about.html")).text();
    expect(content).toBe("<html>about</html>");
  });
});
