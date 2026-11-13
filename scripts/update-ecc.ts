#!/usr/bin/env node
/**
 * Safe, reproducible ECC updater.
 *
 * Usage:
 *   npm run update-ecc -- <tag-or-commit> [options]
 *
 * Options:
 *   --root <dir>        Package root (default: repo root)
 *   --ecc <dir>         ECC git checkout (default: <root>/ecc)
 *   --no-fetch          Do not fetch; only local refs (also fails on shallow clones)
 *   --skip-tests        Do not run `npm test` after the build (not recommended)
 *   --dry-run           Analyze and write the report without checkout/build
 *   --report-dir <dir>  Report directory (default: <root>/docs/pi-port)
 *
 * The updater never commits. It prints a summary and asks for confirmation when
 * running interactively; committing is always a manual step.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { HOOK_SPECS } from "../lib/ecc-hooks-core.ts";
import {
  analyzeCommands,
  analyzeHooks,
  analyzeSkills,
  renderUpdateReport,
  type ManifestInfo,
  type UpdateReportData,
} from "./lib/ecc-report.ts";
import {
  checkout,
  currentCommit,
  currentExactTag,
  diffNameStatus,
  diffText,
  ensureFullClone,
  fetchTags,
  isGitRepo,
  isShallow,
  listDirsAt,
  listFilesAt,
  logRange,
  readVersionAt,
  remoteUrl,
  resolveCommit,
  safeCheckout,
  showFileAt,
  statusPorcelain,
} from "./lib/ecc-git.ts";
import { deriveEccLock, readEccLock, writeEccLock, type EccLock } from "./lib/ecc-lock.ts";
import { copyDir, readJson } from "./lib/fs-utils.ts";
import { generateAll, REPO_ROOT } from "./lib/generate.ts";
import { listOverlaySkills } from "./lib/overlays.ts";

const RELEVANT_PATHS = ["skills", "agents", "commands", "hooks", "rules", "scripts", "manifests", "VERSION"];
const BACKUP_PATHS = [
  "skills",
  "rules",
  "prompts",
  "config/agents-generated.json",
  "docs/pi-port/02-commands.md",
  "ecc.lock",
];

interface Args {
  ref?: string;
  root: string;
  eccDir: string;
  fetch: boolean;
  tests: boolean;
  dryRun: boolean;
  reportDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    root: REPO_ROOT,
    eccDir: "",
    fetch: true,
    tests: true,
    dryRun: false,
    reportDir: "",
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--root":
        args.root = path.resolve(next());
        break;
      case "--ecc":
        args.eccDir = path.resolve(next());
        break;
      case "--no-fetch":
        args.fetch = false;
        break;
      case "--skip-tests":
        args.tests = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--report-dir":
        args.reportDir = path.resolve(next());
        break;
      case "-h":
      case "--help":
        process.stdout.write(
          [
            "Usage: npm run update-ecc -- <tag-or-commit> [options]",
            "",
            "  --root <dir>        Package root (default: repo root)",
            "  --ecc <dir>         ECC checkout (default: <root>/ecc)",
            "  --no-fetch          Use local refs only (fails on shallow clones)",
            "  --skip-tests        Skip npm test after build (not recommended)",
            "  --dry-run           Analyze only; no checkout/build",
            "  --report-dir <dir>  Report output (default: <root>/docs/pi-port)",
            "",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
        positional.push(arg);
    }
  }
  args.ref = positional[0];
  if (!args.eccDir) args.eccDir = path.join(args.root, "ecc");
  if (!args.reportDir) args.reportDir = path.join(args.root, "docs", "pi-port");
  return args;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function readManifest(eccDir: string, commit: string): ManifestInfo | null {
  const raw = showFileAt(eccDir, commit, "manifests/pi-core.json");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      skills?: { include?: string[]; exclude?: Record<string, string>; rename?: Record<string, string> };
    };
    return {
      include: parsed.skills?.include ?? [],
      exclude: parsed.skills?.exclude ?? {},
      rename: parsed.skills?.rename ?? {},
    };
  } catch {
    return null;
  }
}

function portCommandSources(root: string): string[] {
  try {
    const config = readJson<{ commands: Array<{ source: string }> }>(path.join(root, "config", "commands-allowlist.json"));
    return config.commands.map((command) => command.source).sort();
  } catch {
    return [];
  }
}

function backupArtifacts(root: string): { dir: string; present: Record<string, boolean> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-update-backup-"));
  const present: Record<string, boolean> = {};
  for (const rel of BACKUP_PATHS) {
    const source = path.join(root, rel);
    present[rel] = fs.existsSync(source);
    if (!present[rel]) continue;
    const dest = path.join(dir, rel);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) copyDir(source, dest);
    else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
    }
  }
  return { dir, present };
}

function restoreArtifacts(root: string, backup: { dir: string; present: Record<string, boolean> }): { ok: boolean; error?: string; restored: string[] } {
  const restored: string[] = [];
  try {
    for (const rel of BACKUP_PATHS) {
      const dest = path.join(root, rel);
      fs.rmSync(dest, { recursive: true, force: true });
      if (!backup.present[rel]) continue;
      const source = path.join(backup.dir, rel);
      const stat = fs.statSync(source);
      if (stat.isDirectory()) copyDir(source, dest);
      else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(source, dest);
      }
      restored.push(rel);
    }
    return { ok: true, restored };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), restored };
  }
}

function runTests(root: string): { ran: boolean; ok: boolean; exitCode: number | null; tail: string } {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm test"] : ["test"];
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const tail = output.split(/\r?\n/).slice(-40).join("\n");
  return {
    ran: true,
    ok: result.status === 0,
    exitCode: result.status,
    tail,
  };
}

function runBuild(
  root: string,
  eccDir: string,
  sourceRef: string,
): {
  ok: boolean;
  summary?: string;
  error?: string;
  durationMs: number;
  overlays: Array<{ skill: string; target: string; path: string }>;
} {
  const started = Date.now();
  try {
    const result = generateAll({
      eccRoot: eccDir,
      outRoot: root,
      configRoot: path.join(root, "config"),
      docsRoot: path.join(root, "docs", "pi-port"),
      overlaysRoot: path.join(root, "overlays"),
      sourceRef,
    });
    const summary = [
      `ECC source version: ${result.eccVersion} (${sourceRef})`,
      `skills: ${result.skills.copied} (${result.skills.files} files, ${result.skills.overlays} overlay(s))`,
      `rules: ${result.rules.stacks} stacks (${result.rules.files} files)`,
      `prompts: ${result.prompts.commands}`,
      `agents: ${result.agents.agents}`,
      ...result.warnings.map((warning) => `warning: ${warning}`),
      "build OK",
    ].join("\n");
    return { ok: true, summary, durationMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error),
      durationMs: Date.now() - started,
    };
  }
}

function reportFileName(reportDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = path.join(reportDir, `update-${date}.md`);
  if (!fs.existsSync(base)) return base;
  const time = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return path.join(reportDir, `update-${date}-${time}.md`);
}

function writeReport(reportDir: string, content: string): string {
  fs.mkdirSync(reportDir, { recursive: true });
  const file = reportFileName(reportDir);
  fs.writeFileSync(file, `${content.trimEnd()}\n`, "utf8");
  return file;
}

function shortList(values: string[], max = 6): string {
  if (values.length === 0) return "ninguno";
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} (+${values.length - max})` : shown;
}

function askConfirmation(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log("Modo no interactivo: no se commitea nada. Revisá el reporte y commiteá manualmente cuando confirmes.");
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("¿Revisaste los cambios y confirmás para commitear? [s/N] ", (answer) => {
    rl.close();
    if (String(answer).trim().toLowerCase() === "s") {
      log("Confirmado. Por diseño el updater NO ejecuta el commit: revisá y commiteá vos cuando quieras.");
    } else {
      log("No se commiteó nada. Los cambios quedan en el working tree para que los revises.");
    }
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ref) {
    throw new Error("Falta <tag-o-commit>. Uso: npm run update-ecc -- v2.2.4");
  }
  const root = args.root;
  const eccDir = args.eccDir;
  if (!fs.existsSync(eccDir) || !isGitRepo(eccDir)) {
    throw new Error(`./ecc no es un repositorio git: ${eccDir}`);
  }
  const dirty = statusPorcelain(eccDir);
  if (dirty) {
    throw new Error(`./ecc tiene cambios locales; abortando para no pisarlos.\n${dirty}`);
  }

  const lock = readEccLock(root);
  const headCommit = currentCommit(eccDir);
  if (lock && lock.commit !== headCommit) {
    throw new Error(
      `El HEAD de ./ecc (${headCommit.slice(0, 7)}) no coincide con ecc.lock (${lock.commit.slice(0, 7)}).\n` +
        "Corré `npm run build` o revisá el estado antes de actualizar.",
    );
  }
  const oldLock = lock ?? deriveEccLock(root, eccDir);
  const oldCommit = oldLock.commit;
  const notes: string[] = [];
  if (!lock) notes.push("No existía `ecc.lock`; se creó a partir del estado actual.");

  if (isShallow(eccDir)) {
    const converted = ensureFullClone(eccDir, { fetch: args.fetch, log });
    if (converted) notes.push("`./ecc` era un clon shallow y se convirtió a clon completo para poder checkout de tags.");
  }
  if (args.fetch) {
    log("git fetch --tags --prune origin");
    fetchTags(eccDir);
  }

  const targetCommit = resolveCommit(eccDir, args.ref);
  if (!targetCommit) {
    throw new Error(`No se pudo resolver la ref '${args.ref}'. Probá con fetch habilitado o un tag/commit existente.`);
  }
  const targetTag = currentExactTag(eccDir, targetCommit);
  const targetLock: EccLock = {
    repository: remoteUrl(eccDir),
    ref: targetTag || args.ref,
    commit: targetCommit,
    version: readVersionAt(eccDir, targetCommit),
    updatedAt: new Date().toISOString(),
  };

  log(`ECC actual: ${oldLock.ref} (${oldCommit.slice(0, 7)}) · objetivo: ${targetLock.ref} (${targetCommit.slice(0, 7)})`);

  const commits = logRange(eccDir, oldCommit, targetCommit, RELEVANT_PATHS);
  const changedFiles = diffNameStatus(eccDir, oldCommit, targetCommit, RELEVANT_PATHS);
  if (commits.length === 0 && changedFiles.length > 0) {
    notes.push(
      "La ref objetivo no es descendiente lineal de la actual (downgrade o ramas divergentes): el log old..new está vacío, pero el diff muestra los cambios.",
    );
  }

  const changedPaths = changedFiles.map((entry) => entry.path);
  const diffs: Record<string, string> = {};
  for (const change of changedFiles) {
    if (!/^scripts\/(hooks|lib)\/[^/]+\.js$/.test(change.path)) continue;
    diffs[change.path] = diffText(eccDir, oldCommit, targetCommit, change.path);
  }

  const oldManifest = readManifest(eccDir, oldCommit);
  const newManifest = readManifest(eccDir, targetCommit);
  const oldDirs = listDirsAt(eccDir, oldCommit, "skills");
  const newDirs = listDirsAt(eccDir, targetCommit, "skills");
  const oldCommands = listFilesAt(eccDir, oldCommit, "commands")
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.basename(file, ".md"));
  const newCommands = listFilesAt(eccDir, targetCommit, "commands")
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.basename(file, ".md"));
  const overlays = listOverlaySkills(path.join(root, "overlays"));

  const skills = analyzeSkills({
    oldDirs,
    newDirs,
    oldManifest,
    newManifest,
    overlays,
    changedFiles: changedPaths,
  });
  const commands = analyzeCommands({
    oldCommands,
    newCommands,
    portSources: portCommandSources(root),
  });
  const hooks = analyzeHooks({
    oldHooksJson: showFileAt(eccDir, oldCommit, "hooks/hooks.json"),
    newHooksJson: showFileAt(eccDir, targetCommit, "hooks/hooks.json"),
    oldHookFiles: listFilesAt(eccDir, oldCommit, "scripts/hooks").filter((file) => file.endsWith(".js")),
    newHookFiles: listFilesAt(eccDir, targetCommit, "scripts/hooks").filter((file) => file.endsWith(".js")),
    changedFiles,
    adapterSpecs: HOOK_SPECS.map((spec) => ({ id: spec.id, script: spec.script })),
    diffs,
  });

  const rulesChanged = changedFiles.filter((entry) => entry.path.startsWith("rules/"));
  const agentsChanged = changedFiles.filter((entry) => entry.path.startsWith("agents/"));
  const scriptsChanged = changedFiles.filter(
    (entry) => entry.path.startsWith("scripts/") && !entry.path.startsWith("scripts/hooks/") && !entry.path.startsWith("scripts/lib/"),
  );

  const baseReport = {
    command: `npm run update-ecc -- ${args.ref}`,
    oldLock,
    targetLock,
    oldCommit,
    targetCommit,
    commits,
    changedFiles,
    skills,
    commands,
    hooks,
    rulesChanged,
    agentsChanged,
    scriptsChanged,
    notes,
  };

  const sameTarget = targetCommit === oldCommit;
  if (sameTarget) notes.push("La ref pedida es la misma que la versión actual; no hay cambios que aplicar.");
  if (args.dryRun) {
    const report = renderUpdateReport({
      ...baseReport,
      status: "dry-run",
      build: { ok: false, summary: "No ejecutado (dry-run).", durationMs: 0 },
      tests: { ran: false, ok: false, exitCode: null, tail: "" },
      rollback: { attempted: false, ok: true, restoredArtifacts: [] },
      overlaysUsed: [],
    });
    const file = writeReport(args.reportDir, report);
    log("\nDRY-RUN: no se hizo checkout ni build.");
    log(`Reporte: ${file}`);
    log(`Commits relevantes: ${commits.length} · archivos: ${changedFiles.length}`);
    log(`Hooks de riesgo: ${hooks.adapterRisks.filter((risk) => risk.severity !== "none").map((risk) => risk.id).join(", ") || "ninguno"}`);
    return;
  }

  const backup = backupArtifacts(root);
  let rollbackState: UpdateReportData["rollback"] = { attempted: false, ok: true, restoredArtifacts: [] };
  let build: UpdateReportData["build"] = { ok: false, error: "no ejecutado" };
  let tests: UpdateReportData["tests"] = { ran: false, ok: false, exitCode: null, tail: "" };
  let overlaysUsed: Array<{ skill: string; target: string; path: string }> = [];
  let status: UpdateReportData["status"] = "success";
  let failure: string | undefined;

  try {
    log(`git checkout --detach --force ${targetCommit.slice(0, 7)}`);
    checkout(eccDir, targetCommit);

    log("build: regenerando skills, rules, prompts y agentes…");
    build = runBuild(root, eccDir, targetLock.ref || targetCommit.slice(0, 7));
    if (!build.ok) throw new Error(`Build falló:\n${build.error || ""}`);

    if (args.tests) {
      log("tests: npm test");
      tests = runTests(root);
      if (!tests.ok) throw new Error(`Tests fallaron (exit ${tests.exitCode}).`);
    } else {
      notes.push("Tests omitidos con --skip-tests.");
    }

    if (!sameTarget) {
      writeEccLock(root, targetLock);
      log(`ecc.lock actualizado a ${targetLock.ref} (${targetCommit.slice(0, 7)})`);
    } else {
      status = "no-op";
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    // Rollback: ECC checkout + all generated artifacts, in that order.
    const checkoutResult = safeCheckout(eccDir, oldCommit);
    const restored = restoreArtifacts(root, backup);
    rollbackState = {
      attempted: true,
      ok: checkoutResult.ok && restored.ok,
      error: [checkoutResult.error, restored.error].filter(Boolean).join(" | ") || undefined,
      restoredArtifacts: restored.restored,
    };
    status = "rolled-back";
    notes.push(`Rollback por: ${failure.split("\n")[0]}`);
    if (!checkoutResult.ok) notes.push("⚠️ No se pudo restaurar el checkout de ECC; revisar manualmente.");
    if (!restored.ok) notes.push("⚠️ No se pudieron restaurar todos los artefactos generados; revisar manualmente.");
  } finally {
    fs.rmSync(backup.dir, { recursive: true, force: true });
  }

  const report = renderUpdateReport({
    ...baseReport,
    status,
    build,
    tests,
    rollback: rollbackState,
    overlaysUsed,
  });
  const file = writeReport(args.reportDir, report);

  log("");
  if (status === "success" || status === "no-op") {
    log(`${status === "success" ? "✅" : "➖"} ECC ${status === "success" ? "actualizado" : "sin cambios"}: ${targetLock.ref} (${targetCommit.slice(0, 7)})`);
    log(`Build: OK · Tests: ${tests.ran ? (tests.ok ? "OK" : "FALLARON") : "omitidos"}`);
    log(`Skills: ${newDirs.length} en ECC · allowlist ${newManifest?.include.length ?? 0} · overlays ${overlays.length}`);
    if (hooks.adapterRisks.some((risk) => risk.severity !== "none")) {
      log(`Hooks a revisar: ${hooks.adapterRisks.filter((risk) => risk.severity !== "none").map((risk) => `${risk.id}(${risk.severity})`).join(", ")}`);
    }
    if (commands.addedNotInPort.length > 0) log(`Commands nuevos no portados: ${shortList(commands.addedNotInPort)}`);
    if (skills.unclassifiedNew.length > 0) log(`Skills nuevas sin clasificar: ${shortList(skills.unclassifiedNew)}`);
    const overlaysToReview = skills.overlays.filter((overlay) => overlay.baseChanged || overlay.baseMissing);
    if (overlaysToReview.length > 0) {
      log(`Overlays a revisar: ${overlaysToReview.map((overlay) => overlay.name).join(", ")}`);
    }
  } else {
    log("⛔ Actualización revertida. ECC volvió a " + oldLock.ref + ` (${oldCommit.slice(0, 7)})`);
    log(`Rollback: ${rollbackState.ok ? "OK" : "CON ERROR — revisar manualmente"}`);
    log(`Causa: ${failure?.split("\n")[0] ?? "desconocida"}`);
  }
  log(`Reporte: ${file}`);
  if (status === "rolled-back") process.exitCode = 1;
  log("");
  askConfirmation();
}

try {
  main();
} catch (error) {
  process.stderr.write(`update-ecc: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
