#!/usr/bin/env node
/**
 * Pre-publish sanity checks. Run by `prepublishOnly` after `npm run verify`.
 *
 * Verifies metadata, ecc.lock consistency, generated artifacts, required docs
 * and the actual npm tarball contents (no .git, no node_modules, no .pi-port).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { currentCommit, isGitRepo } from "./lib/ecc-git.ts";
import { readEccLock } from "./lib/ecc-lock.ts";
import { readJson } from "./lib/fs-utils.ts";
import { REPO_ROOT } from "./lib/generate.ts";

interface PackageJson {
  name?: string;
  version?: string;
  license?: string;
  repository?: { url?: string } | string;
  files?: string[];
  pi?: Record<string, string[] | string>;
}

function fail(message: string): never {
  throw new Error(message);
}

function npmPackFiles(root: string): string[] {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm pack --dry-run --json"] : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) fail(`npm pack --dry-run falló: ${result.stderr || result.stdout}`);
  const stdout = (result.stdout || "").trim();
  const start = stdout.indexOf("[");
  if (start === -1) fail(`No se pudo parsear npm pack --dry-run --json: ${stdout.slice(0, 500)}`);
  const parsed = JSON.parse(stdout.slice(start)) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0].files.map((file) => file.path);
}

function main(): void {
  const root = REPO_ROOT;
  const problems: string[] = [];
  const warnings: string[] = [];

  const pkg = readJson<PackageJson>(path.join(root, "package.json"));
  if (pkg.name !== "ecc-pi-port") problems.push(`package name should be ecc-pi-port (got ${pkg.name})`);
  if (!pkg.version) problems.push("package.json version is missing");
  if (pkg.license !== "MIT") problems.push("license should be MIT");
  if (!pkg.repository) problems.push("repository field is missing");
  if (!pkg.pi) problems.push("pi manifest is missing");
  for (const key of ["extensions", "skills", "prompts"] as const) {
    const entries = Array.isArray(pkg.pi?.[key]) ? (pkg.pi?.[key] as string[]) : [];
    for (const entry of entries) {
      if (entry.includes("*")) continue;
      if (!fs.existsSync(path.join(root, entry))) problems.push(`pi.${key} path missing: ${entry}`);
    }
  }

  for (const file of ["README.md", "README.es.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "ecc.lock"]) {
    if (!fs.existsSync(path.join(root, file))) problems.push(`missing required file: ${file}`);
  }

  const changelog = fs.existsSync(path.join(root, "CHANGELOG.md"))
    ? fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
    : "";
  if (pkg.version && !changelog.includes(`## [${pkg.version}]`)) {
    warnings.push(`CHANGELOG.md has no "## [${pkg.version}]" heading`);
  }

  const lock = readEccLock(root);
  if (!lock) problems.push("ecc.lock is missing or invalid");
  else {
    const eccDir = path.join(root, "ecc");
    if (isGitRepo(eccDir)) {
      try {
        if (currentCommit(eccDir) !== lock.commit) {
          problems.push(`./ecc HEAD (${currentCommit(eccDir).slice(0, 7)}) != ecc.lock (${lock.commit.slice(0, 7)})`);
        }
      } catch (error) {
        warnings.push(`could not verify ecc HEAD: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      warnings.push("./ecc is not a git checkout; cannot verify the lock commit (expected for packed installs)");
    }
  }

  for (const dir of ["skills", "rules", "prompts"]) {
    if (!fs.existsSync(path.join(root, dir)) || fs.readdirSync(path.join(root, dir)).length === 0) {
      problems.push(`generated directory missing or empty: ${dir}/ (run npm run build)`);
    }
  }
  for (const file of ["config/agents-generated.json", "docs/pi-port/02-commands.md"]) {
    if (!fs.existsSync(path.join(root, file))) problems.push(`generated file missing: ${file} (run npm run build)`);
  }

  let files: string[] = [];
  try {
    files = npmPackFiles(root);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (files.length > 0) {
    const fileSet = new Set(files);
    const required = [
      "package.json",
      "README.md",
      "README.es.md",
      "LICENSE",
      "SECURITY.md",
      "CHANGELOG.md",
      "ecc.lock",
      "extensions/ecc-hooks.ts",
      "extensions/ecc-rules.ts",
      "extensions/ecc-agents.ts",
      "extensions/ecc-sdd.ts",
      "lib/ecc-hooks-core.ts",
      "config/agents-generated.json",
      "ecc/scripts/hooks/run-with-flags.js",
      "docs/pi-port/STATUS.md",
    ];
    for (const entry of required) {
      if (!fileSet.has(entry)) problems.push(`tarball is missing ${entry}`);
    }
    for (const entry of files) {
      if (entry.startsWith("node_modules/") || entry.startsWith(".pi-port/") || entry === "ecc/.git" || entry.startsWith("ecc/.git/")) {
        problems.push(`tarball must not include ${entry}`);
      }
    }
    const skillFiles = files.filter((entry) => entry.startsWith("skills/") && entry.endsWith("SKILL.md"));
    if (skillFiles.length < 100) problems.push(`tarball has too few skills (${skillFiles.length}); run npm run build`);
  }

  for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`error: ${problem}\n`);
    throw new Error(`release-check failed (${problems.length} problem(s))`);
  }
  process.stdout.write(
    `release-check OK: ${pkg.name}@${pkg.version} · ${files.length} files · ECC ${lock?.ref} (${lock?.commit.slice(0, 7)})\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
