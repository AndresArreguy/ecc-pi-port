#!/usr/bin/env node
/** Regenerates only rules/. Prefer `npm run build` (builds everything). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRules } from "./lib/generate-rules.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = generateRules({ eccRoot: path.join(ROOT, "ecc"), outRoot: ROOT });
process.stdout.write(`generated rules/ (${result.stacks.length} stacks, ${result.files} files)\n`);
