export interface DownloadRecord {
  local: string;
  status: "ok" | "failed" | "pending";
  error?: string;
}

export interface Assets {
  css: string[];
  js: string[];
  images: string[];
  fonts: string[];
  icons: string[];
}

export interface CloneOpts {
  pages?: number;
  images?: number;
  noCdn?: boolean;
  concurrency?: number;
  cookie?: string;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
  resume?: boolean;
  inlineScripts?: boolean;
  inlineStyles?: boolean;
  silent?: boolean;
}

export interface SiteSummary {
  url: string;
  hostname: string;
  clonedAt: string;
  elapsed: number;
  maxPages: number;
  pagesDownloaded: number;
  assets: {
    pages: number;
    css: number;
    js: number;
    images: number;
    fonts: number;
    total: number;
  };
  totalBytes: number;
  domains: string[];
  failed: { url: string; reason: string }[];
  outputDir: string;
}

export type AssetType = "css" | "js" | "img" | "font" | "icon" | "page";

export interface ProgressReporter {
  start(): void;
  stop(): void;
  setPhase(name: string): void;
  tick(type: AssetType, file: string, bytes?: number): void;
  tickFail(): void;
  addTotal(n: number): void;
}
