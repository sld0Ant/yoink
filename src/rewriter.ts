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

export function rewriteHtml(
  html: string,
  origin: string,
  assetMap: Map<string, string>,
  depth: number
): string {
  let result = html;
  const prefix = "../".repeat(depth);
  const sorted = [...assetMap.entries()].sort((a, b) => b[0].length - a[0].length);

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

  return result;
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
