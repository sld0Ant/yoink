export interface DownloadRecord {
  local: string;
  status: "ok" | "failed" | "pending";
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
}

export type AssetType = "css" | "js" | "img" | "font" | "icon" | "page";
