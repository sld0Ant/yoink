import { ANSI } from "./constants";
import type { AssetType, ProgressReporter } from "./types";

const { gray, reset } = ANSI;

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

  start() {}
  stop() {}

  setPhase(name: string) {
    this.phase = name;
    process.stdout.write(`  ${name}\n`);
  }

  tick(type: AssetType, file: string, fileBytes = 0) {
    this.done++;
    this.counts[type]++;
    this.bytes += fileBytes;
    this.currentFile = file;
    process.stdout.write(`  ${gray}${type}:${reset} ${file}\n`);
  }

  tickFail() {
    this.done++;
    this.failed++;
  }

  addTotal(n: number) {
    this.total += n;
  }
}
