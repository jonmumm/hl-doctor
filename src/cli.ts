#!/usr/bin/env node
// Explains why money or actions didn't land on HyperCore. Run `hl-doctor --help` for usage.
import { run } from "./main.ts";

process.exitCode = await run(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  color: process.stdout.isTTY === true,
});
