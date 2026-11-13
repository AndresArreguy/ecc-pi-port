#!/usr/bin/env node
/** Backwards-compatible wrapper. Prefer `npm run build` (builds everything). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgents } from "./lib/generate-agents.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = generateAgents({
  eccRoot: path.join(ROOT, "ecc"),
  configRoot: path.join(ROOT, "config"),
  outRoot: ROOT,
});

process.stdout.write(`generated config/agents-generated.json (${result.agents.length} agents, ECC ${result.version})\n`);
for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`);
