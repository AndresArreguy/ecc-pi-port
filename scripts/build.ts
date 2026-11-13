#!/usr/bin/env node
/**
 * Single build entrypoint: regenerates skills, rules, prompts and agent data
 * from ./ecc (read-only source) into the Pi package layout.
 *
 * Usage:
 *   npm run build
 *   npm run build -- --check      # verify committed outputs are up to date
 *   node --experimental-strip-types scripts/build.ts --ecc <dir> --out <dir>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEccLock } from "./lib/ecc-lock.ts";
import { currentCommit, isGitRepo } from "./lib/ecc-git.ts";
import { diffDirs, readJson } from "./lib/fs-utils.ts";
import { generateAll, REPO_ROOT } from "./lib/generate.ts";

interface Args {
  eccRoot: string;
  outRoot: string;
  configRoot: string;
  docsRoot: string;
  check: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    eccRoot: path.join(REPO_ROOT, "ecc"),
    outRoot: REPO_ROOT,
    configRoot: path.join(REPO_ROOT, "config"),
    docsRoot: path.join(REPO_ROOT, "docs", "pi-port"),
    check: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--ecc":
        args.eccRoot = path.resolve(next());
        break;
      case "--out":
        args.outRoot = path.resolve(next());
        break;
      case "--config":
        args.configRoot = path.resolve(next());
        break;
      case "--docs":
        args.docsRoot = path.resolve(next());
        break;
      case "--check":
        args.check = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(
          [
            "Usage: build.ts [options]",
            "",
            "  --ecc <dir>     ECC source root (default: ./ecc)",
            "  --out <dir>     Package output root (default: repo root)",
            "  --config <dir>  Build input config (default: ./config)",
            "  --docs <dir>    Generated docs target (default: ./docs/pi-port)",
            "  --check         Generate to a temp dir and fail on drift",
            "  --json          Print the summary as JSON",
            "",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function validateEccLock(root: string, eccRoot: string): string[] {
  const lock = readEccLock(root);
  if (!lock || !isGitRepo(eccRoot)) return [];
  try {
    const head = currentCommit(eccRoot);
    if (head !== lock.commit) {
      return [
        `ecc HEAD (${head.slice(0, 7)}) no coincide con ecc.lock (${lock.ref}, ${lock.commit.slice(0, 7)}). ` +
          "Corré `npm run update-ecc -- <ref>` o actualizá el lock antes de buildear.",
      ];
    }
  } catch {
    return [];
  }
  return [];
}

function validateManifest(outRoot: string): string[] {
  const problems: string[] = [];
  const pkgPath = path.join(outRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return [`package.json not found at ${pkgPath}`];
  const pkg = readJson<{ pi?: Record<string, string[]>; name?: string; version?: string }>(pkgPath);
  if (!pkg.pi) problems.push("package.json has no `pi` manifest");
  if (!pkg.name) problems.push("package.json has no `name`");
  if (!pkg.version) problems.push("package.json has no `version`");
  for (const key of ["extensions", "skills", "prompts"]) {
    for (const entry of pkg.pi?.[key] ?? []) {
      if (entry.includes("*")) continue;
      const resolved = path.resolve(outRoot, entry);
      if (!fs.existsSync(resolved)) problems.push(`pi.${key} path does not exist: ${entry}`);
    }
  }
  return problems;
}

function compareOutputs(tmpRoot: string, outRoot: string, docsRoot: string): string[] {
  const diffs: string[] = [];
  for (const dir of ["skills", "rules", "prompts"]) {
    diffs.push(...diffDirs(path.join(tmpRoot, dir), path.join(outRoot, dir)).map((d) => `${dir}/${d}`));
  }
  const generatedDoc = path.join(tmpRoot, "docs", "pi-port", "02-commands.md");
  const actualDoc = path.join(docsRoot, "02-commands.md");
  if (!fs.existsSync(actualDoc)) {
    diffs.push("docs/pi-port/02-commands.md missing");
  } else if (!fs.readFileSync(generatedDoc).equals(fs.readFileSync(actualDoc))) {
    diffs.push("docs/pi-port/02-commands.md changed");
  }
  const generatedAgents = path.join(tmpRoot, "config", "agents-generated.json");
  const actualAgents = path.join(outRoot, "config", "agents-generated.json");
  if (!fs.existsSync(actualAgents)) {
    diffs.push("config/agents-generated.json missing");
  } else if (!fs.readFileSync(generatedAgents).equals(fs.readFileSync(actualAgents))) {
    diffs.push("config/agents-generated.json changed");
  }
  return diffs;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const eccLock = readEccLock(args.outRoot);
  const sourceRef = eccLock?.ref ?? null;

  if (!args.check) {
    const result = generateAll({
      eccRoot: args.eccRoot,
      outRoot: args.outRoot,
      configRoot: args.configRoot,
      docsRoot: args.docsRoot,
      sourceRef,
    });
    const manifestProblems = [...validateEccLock(args.outRoot, args.eccRoot), ...validateManifest(args.outRoot)];
    const summary = { mode: "build", ...result, manifestProblems };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          `ECC source version: ${result.eccVersion}${sourceRef ? ` (${sourceRef})` : ""}`,
          `skills: ${result.skills.copied} (${result.skills.files} files, ${result.skills.overlays} overlay(s))`,
          `rules: ${result.rules.stacks} stacks (${result.rules.files} files)`,
          `prompts: ${result.prompts.commands}`,
          `agents: ${result.agents.agents}`,
          ...result.warnings.map((w) => `warning: ${w}`),
          ...manifestProblems.map((p) => `manifest: ${p}`),
          "build OK",
        ].join("\n") + "\n",
      );
    }
    if (manifestProblems.length > 0) process.exitCode = 1;
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-build-check-"));
  try {
    generateAll({
      eccRoot: args.eccRoot,
      outRoot: tmpRoot,
      configRoot: args.configRoot,
      docsRoot: path.join(tmpRoot, "docs", "pi-port"),
      sourceRef,
    });
    const diffs = compareOutputs(tmpRoot, args.outRoot, args.docsRoot);
    const manifestProblems = [...validateEccLock(args.outRoot, args.eccRoot), ...validateManifest(args.outRoot)];
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ mode: "check", ok: diffs.length === 0, diffs, manifestProblems }, null, 2)}\n`);
    } else if (diffs.length === 0 && manifestProblems.length === 0) {
      process.stdout.write("check OK: generated outputs are up to date\n");
    } else {
      process.stdout.write(
        [
          ...diffs.map((d) => `drift: ${d}`),
          ...manifestProblems.map((p) => `manifest: ${p}`),
          "check FAILED",
        ].join("\n") + "\n",
      );
    }
    if (diffs.length > 0 || manifestProblems.length > 0) process.exitCode = 1;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
