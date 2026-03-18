#!/usr/bin/env bun

import { parseArgs } from "./src/cli";
import { Cloner } from "./src/cloner";

const { url, dir, opts } = parseArgs();
try {
  await new Cloner(url, dir, opts).run();
} catch (e) {
  console.error(`\n  \x1b[31m${e instanceof Error ? e.message : e}\x1b[0m\n`);
  process.exit(1);
}
