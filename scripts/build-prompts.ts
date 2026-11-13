#!/usr/bin/env node
/** Backwards-compatible wrapper. Prefer `npm run build` (builds everything). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrompts } from "./lib/generate-prompts.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = generatePrompts({
  eccRoot: path.join(ROOT, "ecc"),
  configRoot: path.join(ROOT, "config"),
  outRoot: ROOT,
  docsRoot: path.join(ROOT, "docs", "pi-port"),
});

for (const cmd of result.commands) {
  process.stdout.write(`generated prompts/${cmd.name}.md (${cmd.status})\n`);
}
process.stdout.write("generated docs/pi-port/02-commands.md\n");
