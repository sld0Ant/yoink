import { USER_AGENT, DEFAULT_RETRIES, RETRY_DELAY, TRANSIENT_CODES } from "./constants";

export interface FetcherOpts {
  headers?: Record<string, string>;
  onError?: (url: string, reason: string) => void;
  retries?: number;
  retryDelay?: number;
}

function classifyError(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "timeout";
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("dns") || msg.includes("getaddrinfo") || msg.includes("resolve")) return "dns";
    if (msg.includes("ssl") || msg.includes("tls") || msg.includes("certificate")) return "tls";
  }
  return "network";
}

function isTransient(reason: string): boolean {
  if (reason === "timeout" || reason === "network") return true;
  if (reason.startsWith("http:")) {
    const code = parseInt(reason.slice(5), 10);
    return TRANSIENT_CODES.has(code);
  }
  return false;
}

export class Fetcher {
  private headers: Record<string, string>;
  private onError: (url: string, reason: string) => void;
  private retries: number;
  private retryDelay: number;

  constructor(opts: FetcherOpts = {}) {
    this.headers = {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Linux"',
      ...opts.headers,
    };
    this.onError = opts.onError ?? (() => {});
    this.retries = opts.retries ?? DEFAULT_RETRIES;
    this.retryDelay = opts.retryDelay ?? RETRY_DELAY;
  }

  async text(url: string): Promise<string | null> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: this.headers,
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const reason = `http:${res.status}`;
          if (isTransient(reason) && attempt < this.retries) {
            await Bun.sleep(this.retryDelay * (attempt + 1));
            continue;
          }
          this.onError(url, reason);
          return null;
        }
        return await res.text();
      } catch (err) {
        const reason = classifyError(err);
        if (isTransient(reason) && attempt < this.retries) {
          await Bun.sleep(this.retryDelay * (attempt + 1));
          continue;
        }
        this.onError(url, reason);
        return null;
      }
    }
    return null;
  }

  async binary(url: string, dest: string): Promise<{ bytes: number; error?: string }> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: this.headers,
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const reason = `http:${res.status}`;
          if (isTransient(reason) && attempt < this.retries) {
            await Bun.sleep(this.retryDelay * (attempt + 1));
            continue;
          }
          this.onError(url, reason);
          return { bytes: -1, error: reason };
        }
        const buf = await res.arrayBuffer();
        await Bun.write(dest, buf);
        return { bytes: buf.byteLength };
      } catch (err) {
        const reason = classifyError(err);
        if (isTransient(reason) && attempt < this.retries) {
          await Bun.sleep(this.retryDelay * (attempt + 1));
          continue;
        }
        this.onError(url, reason);
        return { bytes: -1, error: reason };
      }
    }
    return { bytes: -1, error: "network" };
  }
}
