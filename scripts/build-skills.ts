#!/usr/bin/env node
/** Regenerates only skills/. Prefer `npm run build` (builds everything). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSkills } from "./lib/generate-skills.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = generateSkills({ eccRoot: path.join(ROOT, "ecc"), outRoot: ROOT });
process.stdout.write(`generated skills/ (${result.copied} skills, ${result.files} files)\n`);
for (const rename of result.renamed) process.stdout.write(`renamed ${rename.from} -> ${rename.to}\n`);
