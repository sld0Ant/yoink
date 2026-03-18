import { USER_AGENT } from "./constants";

export class Fetcher {
  private headers: Record<string, string>;

  constructor(extra: Record<string, string> = {}) {
    this.headers = {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Linux"',
      ...extra,
    };
  }

  async text(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: this.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }

  async binary(url: string, dest: string): Promise<number> {
    try {
      const res = await fetch(url, {
        headers: this.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return -1;
      const buf = await res.arrayBuffer();
      await Bun.write(dest, buf);
      return buf.byteLength;
    } catch {
      return -1;
    }
  }
}
