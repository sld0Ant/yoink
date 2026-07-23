import type { Assets } from "./types";

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    const sorted = [...u.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => (v ? `${k}=${v}` : k))
      .join("&");
    u.search = sorted ? `?${sorted}` : "";
    return u.href;
  } catch {
    return raw;
  }
}

function abs(url: string, base: string): string {
  try {
    return normalizeUrl(new URL(url, base).href);
  } catch {
    return url;
  }
}

function isFont(url: string): boolean {
  return /\.(woff2?|ttf|eot|otf)(\?|$)/i.test(url);
}

function parseSrcset(raw: string, base: string): string[] {
  const urls: string[] = [];
  for (const entry of raw.split(",")) {
    const src = entry.trim().split(/\s+/)[0];
    if (src && !src.startsWith("data:")) urls.push(abs(src, base));
  }
  return urls;
}

function extractUrlFunctions(text: string, base: string) {
  const fonts: string[] = [];
  const images: string[] = [];
  for (const m of text.matchAll(/url\(\s*['"]?([^'"()\s]+)['"]?\s*\)/gi)) {
    const u = m[1];
    if (u.startsWith("data:") || u.startsWith("#")) continue;
    const resolved = abs(u, base);
    if (isFont(u)) fonts.push(resolved);
    else images.push(resolved);
  }
  return { fonts, images };
}

export function extractHtmlAssets(html: string, baseUrl: string): Assets {
  const a: Assets = { css: [], js: [], images: [], fonts: [], icons: [] };

  for (const m of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi))
    a.css.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*href=["']([^"']+\.css[^"']*)["'][^>]*rel=["']stylesheet["'][^>]*>/gi))
    a.css.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<link[^>]*rel=["'][^"']*(?:icon|apple-touch-icon|shortcut)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi))
    a.icons.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:icon|apple-touch-icon|shortcut)[^"']*["'][^>]*>/gi))
    a.icons.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["'][^>]*>/gi))
    a.js.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["'][^>]*>/gi))
    a.js.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+)["'][^>]*as=["'](?:font)["'][^>]*>/gi))
    a.fonts.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+)["'][^>]*as=["'](?:image)["'][^>]*>/gi))
    a.images.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+)["'][^>]*as=["'](?:style)["'][^>]*>/gi))
    a.css.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+)["'][^>]*as=["'](?:script)["'][^>]*>/gi))
    a.js.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi))
    a.js.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/\.src\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g))
    a.js.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi))
    if (!m[1].startsWith("data:")) a.images.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/<video[^>]*src=["']([^"']+)["'][^>]*>/gi))
    a.images.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<video[^>]*poster=["']([^"']+)["'][^>]*>/gi))
    a.images.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<audio[^>]*src=["']([^"']+)["'][^>]*>/gi))
    a.images.push(abs(m[1], baseUrl));

  for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi))
    a.images.push(...parseSrcset(m[1], baseUrl));

  for (const m of html.matchAll(/<source[^>]*srcset=["']([^"']+)["'][^>]*>/gi))
    a.images.push(...parseSrcset(m[1], baseUrl));

  for (const m of html.matchAll(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/gi))
    if (!m[1].startsWith("data:")) a.images.push(abs(m[1], baseUrl));
  for (const m of html.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi))
    if (!m[1].startsWith("data:")) a.images.push(abs(m[1], baseUrl));

  const inlineUrls = extractUrlFunctions(html, baseUrl);
  a.fonts.push(...inlineUrls.fonts);
  a.images.push(...inlineUrls.images);

  return dedup(a);
}

export function extractCssAssets(css: string, cssUrl: string) {
  const imports: string[] = [];

  for (const m of css.matchAll(/@import\s+url\(\s*['"]?([^'"()\s]+)['"]?\s*\)/gi))
    imports.push(abs(m[1], cssUrl));
  for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi))
    imports.push(abs(m[1], cssUrl));

  const { fonts, images } = extractUrlFunctions(css, cssUrl);

  return {
    css: [...new Set(imports)],
    fonts: [...new Set(fonts)],
    images: [...new Set(images)],
  };
}

export function extractJsImports(js: string, jsUrl: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of js.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        imports.push(abs(specifier, jsUrl));
      }
    }
  }

  return [...new Set(imports)];
}

export function extractInternalLinks(html: string, baseUrl: string, origin: string, homePath: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  for (const m of html.matchAll(/<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const href = m[1];
    if (/^(?:mailto:|tel:|javascript:)/.test(href)) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    if (/\.(pdf|zip|doc|docx|xls|xlsx|png|jpg|gif|svg|mp4)$/i.test(resolved.pathname)) continue;

    const norm = normalizeUrl(resolved.origin + resolved.pathname);
    if (seen.has(norm) || norm === normalizeUrl(homePath)) continue;
    seen.add(norm);
    links.push(norm);
  }
  return links;
}

function dedup(a: Assets): Assets {
  return {
    css: [...new Set(a.css)],
    js: [...new Set(a.js)],
    images: [...new Set(a.images)],
    fonts: [...new Set(a.fonts)],
    icons: [...new Set(a.icons)],
  };
}
