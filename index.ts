#!/usr/bin/env bun

import { parseArgs } from "./src/cli";
import { Cloner } from "./src/cloner";

const { url, dir, opts } = parseArgs();
await new Cloner(url, dir, opts).run();
