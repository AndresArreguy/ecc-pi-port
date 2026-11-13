import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, listDirNames, listFilesRelative, resetDir } from "./fs-utils.ts";

export interface GenerateRulesOptions {
  eccRoot: string;
  outRoot: string;
}

export interface GenerateRulesResult {
  stacks: Array<{ name: string; files: number }>;
  files: number;
}

/**
 * Regenerates `rules/` from `ecc/rules/` (per-stack coding rules) and writes an
 * index. Pi has no native "rules" resource, so `extensions/ecc-rules.ts`
 * consumes this directory; the Markdown stays readable on its own.
 */
export function generateRules(options: GenerateRulesOptions): GenerateRulesResult {
  const eccRoot = path.resolve(options.eccRoot);
  const sourceRules = path.join(eccRoot, "rules");
  const outRules = path.join(path.resolve(options.outRoot), "rules");
  if (!fs.existsSync(sourceRules)) throw new Error(`ECC rules not found: ${sourceRules}`);

  resetDir(outRules);
  ensureDir(outRules);

  const stacks: Array<{ name: string; files: number }> = [];
  let files = 0;
  for (const stack of listDirNames(sourceRules)) {
    const srcStack = path.join(sourceRules, stack);
    const mdFiles = fs.readdirSync(srcStack).filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) continue;
    const destStack = path.join(outRules, stack);
    copyDir(srcStack, destStack);
    const copied = listFilesRelative(destStack).length;
    files += copied;
    stacks.push({ name: stack, files: copied });
  }

  const lines: string[] = [];
  lines.push("# Reglas ECC para Pi");
  lines.push("");
  lines.push("Generado por `npm run build` desde `ecc/rules/`. No editar a mano.");
  lines.push("");
  lines.push("Pi no descubre reglas de forma nativa. La extensión `extensions/ecc-rules.ts`");
  lines.push("las inyecta en el system prompt cuando se activa `ECC_PI_RULES` o `/ecc-rules`.");
  lines.push("");
  lines.push("| Stack | Archivos | Cómo activarlo |");
  lines.push("|---|---|---|");
  for (const stack of stacks) {
    lines.push(`| \`${stack.name}\` | ${stack.files} | \`ECC_PI_RULES=${stack.name}\` o \`/ecc-rules ${stack.name}\` |`);
  }
  lines.push("");
  lines.push("`common` se inyecta siempre junto con el stack elegido.");
  lines.push("");
  fs.writeFileSync(path.join(outRules, "README.md"), lines.join("\n"), "utf8");

  return { stacks, files };
}
