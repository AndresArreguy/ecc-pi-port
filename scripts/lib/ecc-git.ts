import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  readonly result: GitResult;

  constructor(message: string, result: GitResult) {
    super(message);
    this.result = result;
  }
}

export function git(cwd: string, args: string[], options: { allowFail?: boolean } = {}): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const normalized: GitResult = {
    code: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim() || result.error?.message || "",
  };
  if (normalized.code !== 0 && !options.allowFail) {
    throw new GitError(`git ${args.join(" ")} failed (${normalized.code}): ${normalized.stderr || normalized.stdout}`, normalized);
  }
  return normalized;
}

export function gitOk(cwd: string, args: string[]): boolean {
  return git(cwd, args, { allowFail: true }).code === 0;
}

export function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git")) && gitOk(dir, ["rev-parse", "--git-dir"]);
}

export function isShallow(dir: string): boolean {
  return gitOk(dir, ["rev-parse", "--is-shallow-repository"]) && git(dir, ["rev-parse", "--is-shallow-repository"]).stdout === "true";
}

export function currentCommit(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).stdout;
}

export function resolveCommit(dir: string, ref: string): string | null {
  const result = git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true });
  return result.code === 0 && result.stdout ? result.stdout : null;
}

export function currentExactTag(dir: string, commit = "HEAD"): string | null {
  const result = git(dir, ["describe", "--tags", "--exact-match", commit], { allowFail: true });
  return result.code === 0 ? result.stdout : null;
}

export function describeCommit(dir: string, commit = "HEAD"): string {
  const result = git(dir, ["describe", "--tags", "--always", commit], { allowFail: true });
  return result.code === 0 ? result.stdout : commit.slice(0, 7);
}

export function readVersionAt(dir: string, commit?: string): string {
  if (commit) {
    const shown = git(dir, ["show", `${commit}:VERSION`], { allowFail: true });
    if (shown.code === 0) return shown.stdout.trim();
  }
  const file = path.join(dir, "VERSION");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "unknown";
}

export function remoteUrl(dir: string): string {
  const result = git(dir, ["config", "--get", "remote.origin.url"], { allowFail: true });
  return result.code === 0 ? result.stdout : "";
}

export function statusPorcelain(dir: string): string {
  return git(dir, ["status", "--porcelain"]).stdout;
}

export function ensureFullClone(dir: string, options: { fetch: boolean; log?: (message: string) => void }): boolean {
  if (!isShallow(dir)) return false;
  if (!options.fetch) {
    throw new Error(
      "./ecc es un clon shallow y --no-fetch está activo. Corré sin --no-fetch (o manualmente `git -C ecc fetch --unshallow --tags`) para poder checkout de tags.",
    );
  }
  options.log?.("convirtiendo ./ecc de clon shallow a clon completo (git fetch --unshallow --tags)…");
  git(dir, ["fetch", "--unshallow", "--tags", "origin"]);
  return true;
}

export function fetchTags(dir: string): void {
  git(dir, ["fetch", "--tags", "--prune", "origin"]);
}

export function listDirsAt(dir: string, commit: string, prefix: string): string[] {
  const result = git(dir, ["ls-tree", "-d", "--name-only", commit, `${prefix}/`], { allowFail: true });
  if (result.code !== 0 || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(prefix.length + 1))
    .sort();
}

export function listFilesAt(dir: string, commit: string, prefix: string): string[] {
  const result = git(dir, ["ls-tree", "-r", "--name-only", commit, "--", prefix], { allowFail: true });
  if (result.code !== 0 || !result.stdout) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();
}

export function showFileAt(dir: string, commit: string, filePath: string): string | null {
  const result = git(dir, ["show", `${commit}:${filePath}`], { allowFail: true });
  return result.code === 0 ? result.stdout : null;
}

export interface NameStatus {
  status: string;
  path: string;
  oldPath?: string;
}

export function diffNameStatus(dir: string, from: string, to: string, paths: string[]): NameStatus[] {
  if (from === to) return [];
  const args = ["diff", "--name-status", "-M", from, to, "--", ...paths];
  const result = git(dir, args, { allowFail: true });
  if (result.code !== 0 || !result.stdout) return [];
  const out: NameStatus[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 3 && /^R/.test(parts[0])) {
      out.push({ status: parts[0], oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      out.push({ status: parts[0], path: parts[1] });
    }
  }
  return out;
}

export function logRange(dir: string, from: string, to: string, paths: string[], limit = 200): string[] {
  if (from === to) return [];
  const result = git(
    dir,
    ["log", "--oneline", "--no-decorate", `-${limit}`, `${from}..${to}`, "--", ...paths],
    { allowFail: true },
  );
  if (result.code !== 0 || !result.stdout) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

export function diffText(dir: string, from: string, to: string, filePath: string, maxChars = 120_000): string {
  if (from === to) return "";
  const result = git(dir, ["diff", "--no-color", "-M", from, to, "--", filePath], { allowFail: true });
  if (result.code !== 0) return "";
  return result.stdout.length > maxChars ? `${result.stdout.slice(0, maxChars)}\n…(diff truncado)` : result.stdout;
}

export function checkout(dir: string, ref: string): void {
  git(dir, ["checkout", "--detach", "--force", ref]);
}

/** Best-effort restore: never throws, caller reports the outcome. */
export function safeCheckout(dir: string, ref: string): { ok: boolean; error?: string } {
  try {
    checkout(dir, ref);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
