import { mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

export class Namer {
  private counters = new Map<string, number>();
  private outDir: string;

  constructor(outDir: string) {
    this.outDir = outDir;
  }

  alloc(url: string, dir: string): string {
    let name: string;
    try {
      name = basename(new URL(url).pathname).split("?")[0];
    } catch {
      name = "file";
    }
    if (!name || name === "/" || name === "") name = "file";

    let ext = extname(name);
    if (!ext) {
      if (dir.includes("css")) ext = ".css";
      else if (dir.includes("js")) ext = ".js";
      else if (dir.includes("font")) ext = ".woff2";
      if (ext) name += ext;
    }

    const key = `${dir}/${name}`;
    const count = this.counters.get(key) ?? 0;
    this.counters.set(key, count + 1);

    if (count > 0) {
      const base = name.slice(0, name.length - ext.length);
      name = `${base}-${count}${ext}`;
    }

    mkdirSync(join(this.outDir, dir), { recursive: true });
    return `${dir}/${name}`;
  }

  pageSlug(url: string): string {
    try {
      const u = new URL(url);
      let slug = u.pathname.replace(/^\//, "").replace(/\//g, "-").replace(/\.$/, "");
      if (!slug) slug = "page";
      if (!slug.endsWith(".html")) slug += ".html";
      return slug;
    } catch {
      return "page.html";
    }
  }
}
