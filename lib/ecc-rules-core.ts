/**
 * Pure helpers for the ECC rules adapter (`extensions/ecc-rules.ts`).
 * Testable without Pi: stack discovery, detection and rule rendering.
 */
import fs from "node:fs";
import path from "node:path";

export const COMMON_STACK = "common";
export const DEFAULT_MAX_CHARS = 60_000;

export function listRuleStacks(rulesRoot: string): string[] {
  if (!fs.existsSync(rulesRoot)) return [];
  return fs
    .readdirSync(rulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(rulesRoot, name)))
    .sort();
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Best-effort stack detection from project markers. Returns stack names without `common`. */
export function detectStacks(cwd: string): string[] {
  const found = new Set<string>();
  const has = (name: string) => fs.existsSync(path.join(cwd, name));

  if (has("go.mod")) found.add("golang");
  if (has("Cargo.toml")) found.add("rust");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) found.add("python");
  if (has("composer.json")) found.add("php");
  if (has("Gemfile")) found.add("ruby");
  if (has("pubspec.yaml")) found.add("dart");
  if (has("Package.swift")) found.add("swift");
  if (has("CMakeLists.txt")) found.add("cpp");
  if (has("build.gradle") || has("build.gradle.kts") || has("pom.xml")) found.add("java");
  if (has("angular.json")) found.add("angular");
  if (has("nuxt.config.ts") || has("nuxt.config.js")) found.add("nuxt");
  if (has("tsconfig.json")) found.add("typescript");
  if (has("package.json")) found.add("web");

  const pkg = readPackageJson(cwd);
  const deps = {
    ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  if (deps["react-native"] || deps.expo) found.add("react-native");
  else if (deps.react) found.add("react");
  if (deps["@angular/core"] || deps["@angular/cli"]) found.add("angular");
  if (deps.nuxt) found.add("nuxt");
  if (deps.vue && !deps.nuxt) found.add("vue");

  return [...found].sort();
}

export interface ActiveStacks {
  stacks: string[];
  invalid: string[];
}

/**
 * Resolves a raw selector (`auto`, `off`, or whitespace/comma separated stacks).
 * `common` is always added. Unknown stacks are reported instead of silently dropped.
 */
export function resolveActiveStacks(raw: string, cwd: string, rulesRoot: string): ActiveStacks {
  const available = new Set(listRuleStacks(rulesRoot));
  const value = String(raw ?? "").trim();
  if (!value || value.toLowerCase() === "off") return { stacks: [], invalid: [] };

  const requested = value.toLowerCase() === "auto" ? detectStacks(cwd) : value.split(/[\s,]+/).filter(Boolean);
  const invalid = requested.filter((stack) => !available.has(stack));
  const stacks = new Set<string>();
  if (available.has(COMMON_STACK)) stacks.add(COMMON_STACK);
  for (const stack of requested) if (available.has(stack)) stacks.add(stack);
  return { stacks: [...stacks], invalid };
}

export interface LoadedRules {
  text: string;
  stacks: string[];
  files: string[];
  truncated: boolean;
  missingStacks: string[];
}

export function loadRules(
  rulesRoot: string,
  stacks: string[],
  maxChars = DEFAULT_MAX_CHARS,
): LoadedRules {
  const files: string[] = [];
  const missingStacks: string[] = [];
  const parts: string[] = [];
  let truncated = false;
  let used = 0;

  for (const stack of stacks) {
    const dir = path.join(rulesRoot, stack);
    if (!fs.existsSync(dir)) {
      missingStacks.push(stack);
      continue;
    }
    const mdFiles = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .sort();
    for (const file of mdFiles) {
      const rel = `${stack}/${file}`;
      const content = fs.readFileSync(path.join(dir, file), "utf8").trim();
      if (!content) continue;
      const block = `### ${rel}\n\n${content}`;
      if (used + block.length > maxChars) {
        truncated = true;
        break;
      }
      used += block.length;
      files.push(rel);
      parts.push(block);
    }
    if (truncated) break;
  }

  const header = [
    "<ecc-rules>",
    `Stacks: ${stacks.join(", ") || "(none)"}`,
    truncated ? `Truncated at ${maxChars} characters.` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text: parts.length > 0 ? `${header}\n${parts.join("\n\n")}\n</ecc-rules>` : "",
    stacks,
    files,
    truncated,
    missingStacks,
  };
}
