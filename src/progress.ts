import { ANSI } from "./constants";
import type { AssetType, ProgressReporter } from "./types";

const { gray, green, yellow, cyan, red, bold, reset, hideCursor, showCursor, clearLine, up } = ANSI;

export class SilentProgress implements ProgressReporter {
  start() {}
  stop() {}
  setPhase() {}
  tick() {}
  tickFail() {}
  addTotal() {}
}

export class Progress implements ProgressReporter {
  phase = "";
  currentFile = "";
  total = 0;
  done = 0;
  failed = 0;
  bytes = 0;
  counts: Record<AssetType, number> = { css: 0, js: 0, img: 0, font: 0, icon: 0, page: 0 };

  private t0 = performance.now();
  private lines = 0;
  private timer: Timer | null = null;
  private isTTY = process.stdout.isTTY ?? false;

  start() {
    if (!this.isTTY) return;
    process.stdout.write(hideCursor);
    this.timer = setInterval(() => this.render(), 120);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.clear();
    if (this.isTTY) process.stdout.write(showCursor);
  }

  setPhase(name: string) {
    this.phase = name;
    if (!this.isTTY) process.stdout.write(`  ${name}\n`);
  }

  tick(type: AssetType, file: string, fileBytes = 0) {
    this.done++;
    this.counts[type]++;
    this.bytes += fileBytes;
    this.currentFile = file;
    if (!this.isTTY) process.stdout.write(`  ${gray}${type}:${reset} ${file}\n`);
  }

  tickFail() {
    this.done++;
    this.failed++;
  }

  addTotal(n: number) {
    this.total += n;
  }

  private clear() {
    if (!this.isTTY) return;
    for (let i = 0; i < this.lines; i++) {
      process.stdout.write(`${up}${clearLine}`);
    }
    this.lines = 0;
  }

  private render() {
    this.clear();
    const cols = process.stdout.columns ?? 80;
    const elapsed = (performance.now() - this.t0) / 1000;
    const pct = this.total > 0 ? Math.round((this.done / this.total) * 100) : 0;

    const barW = Math.min(30, cols - 40);
    const filled = this.total > 0 ? Math.round((this.done / this.total) * barW) : 0;
    const bar = "━".repeat(filled) + "─".repeat(barW - filled);
    const barColor = pct === 100 ? green : cyan;

    const line1 =
      `  ${bold}${this.phase}${reset}   ${this.done}/${this.total}   ` +
      `${barColor}${bar}${reset}  ${bold}${pct}%${reset}`;

    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.counts)) {
      if (v > 0) parts.push(`${k}:${v}`);
    }
    if (this.failed) parts.push(`${red}✗ ${this.failed}${reset}`);

    const speed = elapsed > 0 ? this.bytes / elapsed : 0;
    const sizeStr =
      this.bytes < 1024 * 1024
        ? `${(this.bytes / 1024).toFixed(0)} KB`
        : `${(this.bytes / 1024 / 1024).toFixed(1)} MB`;
    const speedStr =
      speed < 1024 * 1024
        ? `${(speed / 1024).toFixed(0)} KB/s`
        : `${(speed / 1024 / 1024).toFixed(1)} MB/s`;

    const line2 = `  ${gray}${parts.join("  ")}  │  ↓ ${sizeStr}  ⏱ ${elapsed.toFixed(1)}s  ⚡ ${speedStr}${reset}`;

    const maxName = cols - 6;
    const name = this.currentFile.length > maxName ? "…" + this.currentFile.slice(-maxName + 1) : this.currentFile;
    const line3 = `  ${yellow}→${reset} ${gray}${name}${reset}`;

    for (const l of [line1, line2, line3]) {
      process.stdout.write(l + "\n");
    }
    this.lines = 3;
  }
}
