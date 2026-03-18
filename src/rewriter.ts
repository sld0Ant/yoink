import { relative, dirname } from "node:path";

function replaceInContext(str: string, search: string, replacement: string): string {
  if (!search || !str.includes(search)) return str;

  const prefixes = ['"', "'", "(", "="];
  let result = str;

  for (const p of prefixes) {
    result = result.split(p + search).join(p + replacement);
  }

  return result;
}

function replaceAll(str: string, search: string, replacement: string): string {
  if (!search || !str.includes(search)) return str;
  return str.split(search).join(replacement);
}

function splitSafeZones(html: string): { text: string; isScript: boolean }[] {
  const parts: { text: string; isScript: boolean }[] = [];
  const re = /<script[\s>][\s\S]*?<\/script>/gi;
  let last = 0;

  for (const m of html.matchAll(re)) {
    const start = m.index!;
    if (start > last) parts.push({ text: html.slice(last, start), isScript: false });

    const tag = m[0];
    const hasSrc = /\ssrc\s*=/i.test(tag.slice(0, tag.indexOf(">")));
    parts.push({ text: tag, isScript: !hasSrc });

    last = start + tag.length;
  }

  if (last < html.length) parts.push({ text: html.slice(last), isScript: false });
  return parts;
}

export function rewriteHtml(
  html: string,
  origin: string,
  assetMap: Map<string, string>,
  depth: number
): string {
  const prefix = "../".repeat(depth);
  const sorted = [...assetMap.entries()].sort((a, b) => b[0].length - a[0].length);

  const zones = splitSafeZones(html);

  for (const zone of zones) {
    if (zone.isScript) continue;

    let result = zone.text;
    for (const [origUrl, localRel] of sorted) {
      const to = prefix + localRel;
      result = replaceAll(result, origUrl, to);

      try {
        const u = new URL(origUrl);
        if (u.search) result = replaceInContext(result, u.pathname + u.search, to);
        result = replaceInContext(result, u.pathname, to);
      } catch {
        // skip
      }
    }
    zone.text = result;
  }

  return zones.map((z) => z.text).join("");
}

export function rewriteCss(
  css: string,
  cssFile: string,
  cssOrigUrl: string | undefined,
  assetMap: Map<string, string>
): string {
  let result = css;
  const cssRelDir = dirname(`assets/css/${cssFile}`);
  const sorted = [...assetMap.entries()].sort((a, b) => b[0].length - a[0].length);

  for (const [origUrl, localRel] of sorted) {
    const relPath = relative(cssRelDir, localRel);
    result = replaceAll(result, origUrl, relPath);

    try {
      const u = new URL(origUrl);
      if (u.search) result = replaceInContext(result, u.pathname + u.search, relPath);
      result = replaceInContext(result, u.pathname, relPath);

      if (cssOrigUrl) {
        const resolved = new URL(origUrl, cssOrigUrl).href;
        if (resolved !== origUrl) {
          result = replaceAll(result, resolved, relPath);
          const ru = new URL(resolved);
          if (ru.search) result = replaceInContext(result, ru.pathname + ru.search, relPath);
          result = replaceInContext(result, ru.pathname, relPath);
        }
      }
    } catch {
      // skip
    }
  }

  result = result.replace(/url\(([^)]*)\)/g, (_match, inner: string) => {
    const cleaned = inner.replace(/^(['"]?)([^'"?]+)\?[^'"]*(['"]?)$/, "$1$2$3");
    return `url(${cleaned})`;
  });

  return result;
}
