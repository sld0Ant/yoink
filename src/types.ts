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
