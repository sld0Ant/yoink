import type { CloneOpts } from "./types";

export function parseArgs() {
  const args = Bun.argv.slice(2);
  const opts: CloneOpts = {};
  const positional: string[] = [];
  const headers: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--pages":
        opts.pages = parseInt(args[++i], 10);
        break;
      case "--images":
        opts.images = parseInt(args[++i], 10);
        break;
      case "--no-cdn":
        opts.noCdn = true;
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        break;
      case "--cookie":
      case "-b":
        opts.cookie = args[++i];
        break;
      case "--header":
      case "-H": {
        const val = args[++i];
        const sep = val.indexOf(":");
        if (sep > 0) headers[val.slice(0, sep).trim()] = val.slice(sep + 1).trim();
        break;
      }
      case "--help":
      case "-h":
        console.log(
          [
            "",
            "Usage: yoink <url> [output-dir] [options]",
            "",
            "Options:",
            "  --pages <n>        Max internal pages (default: 20, 0 = homepage only)",
            "  --images <n>       Max images (default: 200, 0 = unlimited)",
            "  --no-cdn           Skip third-party CDN assets",
            "  --concurrency <n>  Parallel downloads (default: 8)",
            "  --cookie, -b <s>   Cookie header (e.g. 'device=desktop')",
            "  --header, -H <s>   Extra header (e.g. 'Accept-Language: ru')",
            "",
          ].join("\n")
        );
        process.exit(0);
        break;
      default:
        if (!args[i].startsWith("-")) positional.push(args[i]);
    }
  }

  if (Object.keys(headers).length > 0) opts.headers = headers;

  if (!positional[0]) {
    console.error("Usage: yoink <url> [output-dir]");
    process.exit(1);
  }

  return { url: positional[0], dir: positional[1] ?? "cloned-site", opts };
}
