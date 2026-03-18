import { join } from "node:path";

export async function inlineScripts(html: string, baseDir: string): Promise<string> {
  const pattern = /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
  let result = html;

  for (const m of html.matchAll(pattern)) {
    const [fullTag, attrsBefore, src, attrsAfter] = m;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) continue;

    const allAttrs = attrsBefore + attrsAfter;
    if (/\basync\b/i.test(allAttrs)) continue;

    const filePath = join(baseDir, src);
    try {
      const raw = await Bun.file(filePath).text();
      const content = raw.replaceAll("</script>", "<\\/script>");
      const attrs = allAttrs.replace(/\s*defer\s*/gi, " ").trim();
      const attrStr = attrs ? ` ${attrs}` : "";
      result = result.replace(fullTag, `<script${attrStr}>${content}</script>`);
    } catch {
      // file missing — leave tag as-is
    }
  }

  return result;
}

export async function inlineStyles(html: string, baseDir: string): Promise<string> {
  const pattern = /<link([^>]*)\srel=["']stylesheet["']([^>]*)\shref=["']([^"']+)["']([^>]*)>/gi;
  const pattern2 = /<link([^>]*)\shref=["']([^"']+)["']([^>]*)\srel=["']stylesheet["']([^>]*)>/gi;
  let result = html;

  for (const p of [pattern, pattern2]) {
    for (const m of html.matchAll(p)) {
      const fullTag = m[0];
      const src = p === pattern ? m[3] : m[2];
      if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) continue;

      const filePath = join(baseDir, src);
      try {
        const raw = await Bun.file(filePath).text();
        const content = raw.replaceAll("</style>", "<\\/style>");
        result = result.replace(fullTag, `<style>${content}</style>`);
      } catch {
        // file missing — leave tag as-is
      }
    }
  }

  return result;
}
