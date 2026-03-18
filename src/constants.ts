export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const CDN_HOSTNAMES = new Set([
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "maxcdn.bootstrapcdn.com",
  "use.fontawesome.com",
  "ka-f.fontawesome.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ajax.googleapis.com",
  "code.jquery.com",
  "cdn.cloudflare.com",
]);

export const DEFAULT_RETRIES = parseInt(process.env.YOINK_RETRIES ?? "2", 10) || 2;
export const RETRY_DELAY = parseInt(process.env.YOINK_RETRY_DELAY ?? "1000", 10) || 1000;
export const TRANSIENT_CODES = new Set([500, 502, 503, 504, 429]);

export const ANSI = {
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  up: "\x1b[A",
} as const;
