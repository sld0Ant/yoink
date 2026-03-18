import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeServer, writeManifest } from "../src/output";
import type { DownloadRecord } from "../src/types";

const TMP = join(import.meta.dir, ".tmp-output");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("writeServer", () => {
  it("copies server template to output dir", async () => {
    await writeServer(TMP);
    const dest = join(TMP, "server.ts");
    expect(existsSync(dest)).toBe(true);

    const content = await Bun.file(dest).text();
    expect(content).toContain("Bun.serve");
    expect(content).toContain("MIME");
    expect(content).toContain("safe(");
  });
});

describe("writeManifest", () => {
  it("writes JSON manifest", async () => {
    const records = new Map<string, DownloadRecord>([
      ["https://example.com/a.js", { local: "assets/js/a.js", status: "ok" }],
      ["https://example.com/b.css", { local: "assets/css/b.css", status: "failed" }],
    ]);

    await writeManifest(TMP, records);
    const dest = join(TMP, "manifest.json");
    expect(existsSync(dest)).toBe(true);

    const parsed = JSON.parse(await Bun.file(dest).text());
    expect(parsed["https://example.com/a.js"].status).toBe("ok");
    expect(parsed["https://example.com/b.css"].status).toBe("failed");
  });

  it("handles empty map", async () => {
    await writeManifest(TMP, new Map());
    const parsed = JSON.parse(await Bun.file(join(TMP, "manifest.json")).text());
    expect(parsed).toEqual({});
  });
});
