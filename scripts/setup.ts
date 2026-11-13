#!/usr/bin/env node
/**
 * One-command bootstrap for a fresh clone:
 *
 *   npm run setup
 *
 * - Installs dev dependencies (typebox for the test suite).
 * - Clones ECC into ./ecc at the commit pinned by ecc.lock.
 * - Regenerates skills, rules, prompts and agent data.
 * - Runs the smoke tests.
 *
 * The updater (`npm run update-ecc -- <tag>`) is the only way to move the lock
 * later. No commits are made.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkout,
  currentCommit,
  ensureFullClone,
  fetchTags,
  isGitRepo,
  isShallow,
  readVersionAt,
  resolveCommit,
  statusPorcelain,
} from "./lib/ecc-git.ts";
import { deriveEccLock, readEccLock, writeEccLock, type EccLock } from "./lib/ecc-lock.ts";
import { REPO_ROOT } from "./lib/generate.ts";

interface Args {
  skipInstall: boolean;
  skipTests: boolean;
  force: boolean;
  noFetch: boolean;
  eccRef?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { skipInstall: false, skipTests: false, force: false, noFetch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--skip-install":
        args.skipInstall = true;
        break;
      case "--skip-tests":
        args.skipTests = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--no-fetch":
        args.noFetch = true;
        break;
      case "--ecc-ref":
        args.eccRef = next();
        break;
      case "-h":
      case "--help":
        process.stdout.write(
          [
            "Usage: npm run setup -- [options]",
            "",
            "  --skip-install   Do not run npm install",
            "  --skip-tests     Do not run npm test",
            "  --force          Re-checkout the lock commit even if HEAD matches",
            "  --no-fetch       Do not fetch tags (offline use)",
            "  --ecc-ref <ref>  Bootstrap a different ECC ref and write ecc.lock",
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

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function checkNode(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    throw new Error(`Node >= 22.6 requerido (actual ${process.versions.node}).`);
  }
}

function run(command: string, args: string[], cwd: string, label: string): void {
  log(`\n$ ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} falló (exit ${result.status})`);
}

function runNpm(script: string, root: string): void {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], root, `npm run ${script}`);
  } else {
    run("npm", ["run", script], root, `npm run ${script}`);
  }
}

function runNpmInstall(root: string): void {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm install --no-audit --no-fund"], root, "npm install");
  } else {
    run("npm", ["install", "--no-audit", "--no-fund"], root, "npm install");
  }
}

const NO_CHECKOUT_MARKER = "pi-ecc-no-checkout";

function cloneEcc(eccDir: string, lock: EccLock): void {
  fs.mkdirSync(path.dirname(eccDir), { recursive: true });
  log(`\nClonando ECC en ${eccDir} (${lock.repository})…`);
  const result = spawnSync("git", ["clone", "--no-checkout", lock.repository, eccDir], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `No se pudo clonar ECC. Verificá red/git o cloná manualmente:\n  git clone ${lock.repository} ecc\n  git -C ecc checkout --detach ${lock.commit}`,
    );
  }
  // `--no-checkout` leaves every tracked file "deleted" in git status.
  // The marker lets a retry distinguish that state from real local edits.
  fs.writeFileSync(path.join(eccDir, ".git", NO_CHECKOUT_MARKER), "created by scripts/setup.ts\n", "utf8");
}

function ensureEcc(root: string, eccDir: string, args: Args): { lock: EccLock; createdLock: boolean } {
  let lock = readEccLock(root);
  let createdLock = false;

  if (!lock) {
    if (!args.eccRef) {
      throw new Error(
        "Falta ecc.lock. Si es la primera vez, elegí una versión:\n  npm run setup -- --ecc-ref v2.2.3",
      );
    }
    if (!fs.existsSync(eccDir)) {
      cloneEcc(eccDir, {
        repository: "https://github.com/affaan-m/ECC.git",
        ref: args.eccRef,
        commit: args.eccRef,
        version: "unknown",
        updatedAt: new Date().toISOString(),
      });
    }
    const commit = resolveCommit(eccDir, args.eccRef) ?? resolveCommit(eccDir, `origin/${args.eccRef}`);
    if (!commit) throw new Error(`No se pudo resolver --ecc-ref '${args.eccRef}'.`);
    checkout(eccDir, commit);
    fs.rmSync(path.join(eccDir, ".git", NO_CHECKOUT_MARKER), { force: true });
    lock = deriveEccLock(root, eccDir);
    writeEccLock(root, lock);
    createdLock = true;
    log(`ecc.lock creado: ${lock.ref} (${lock.commit.slice(0, 7)})`);
    return { lock, createdLock };
  }

  if (!fs.existsSync(eccDir)) cloneEcc(eccDir, lock);
  if (!isGitRepo(eccDir)) throw new Error(`./ecc existe pero no es un repo git: ${eccDir}`);

  if (isShallow(eccDir)) {
    ensureFullClone(eccDir, { fetch: !args.noFetch, log });
  }
  if (!args.noFetch) {
    try {
      fetchTags(eccDir);
    } catch (error) {
      log(`warning: git fetch falló, se usa el estado local (${error instanceof Error ? error.message : error})`);
    }
  }

  const target = resolveCommit(eccDir, lock.commit) ?? resolveCommit(eccDir, lock.ref);
  if (!target) {
    throw new Error(
      `El commit de ecc.lock (${lock.commit}) no está en ./ecc. Corré sin --no-fetch o actualizá el lock.`,
    );
  }
  const marker = path.join(eccDir, ".git", NO_CHECKOUT_MARKER);
  const pendingCheckout = fs.existsSync(marker);
  if (!pendingCheckout && statusPorcelain(eccDir)) {
    throw new Error("./ecc tiene cambios locales; guardalos o descartalos antes de continuar.");
  }
  if (args.force || pendingCheckout || currentCommit(eccDir) !== target) {
    checkout(eccDir, target);
    fs.rmSync(marker, { force: true });
  }
  const actualVersion = readVersionAt(eccDir, target);
  if (lock.version !== "unknown" && actualVersion !== lock.version) {
    log(`warning: ecc.lock.version=${lock.version} pero VERSION en ${target.slice(0, 7)} es ${actualVersion}.`);
  }
  return { lock, createdLock };
}

function printNextSteps(root: string, lock: EccLock): void {
  log("");
  log("✅ Repo listo.");
  log(`   ECC: ${lock.ref} (${lock.commit.slice(0, 7)}) · versión ${lock.version}`);
  log("");
  log("Próximos pasos:");
  log(`  1. pi install ${root}`);
  log("     (o probar sin instalar: pi -e " + root + ")");
  log("  2. Actualizar ECC: npm run update-ecc -- <tag-o-commit>");
  log("  3. Verificar la instalación: npm run verify:install");
  log("  4. Publicar: npm publish (corre verify + release:check en prepublishOnly)");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  checkNode();
  const root = REPO_ROOT;
  const eccDir = path.join(root, "ecc");

  const { lock } = ensureEcc(root, eccDir, args);

  if (!args.skipInstall) runNpmInstall(root);
  runNpm("build", root);
  if (!args.skipTests) runNpm("test", root);

  printNextSteps(root, lock);
}

try {
  main();
} catch (error) {
  process.stderr.write(`setup: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
