import fs from "node:fs";
import path from "node:path";
import { currentCommit, currentExactTag, describeCommit, readVersionAt, remoteUrl } from "./ecc-git.ts";

export interface EccLock {
  repository: string;
  ref: string;
  commit: string;
  version: string;
  updatedAt: string;
}

export const ECC_LOCK_FILE = "ecc.lock";

export function eccLockPath(root: string): string {
  return path.join(root, ECC_LOCK_FILE);
}

export function readEccLock(root: string): EccLock | null {
  const file = eccLockPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EccLock>;
    if (!parsed.commit || !parsed.version) return null;
    return {
      repository: parsed.repository || "",
      ref: parsed.ref || parsed.commit,
      commit: parsed.commit,
      version: parsed.version,
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return null;
  }
}

export function writeEccLock(root: string, lock: EccLock): void {
  fs.writeFileSync(eccLockPath(root), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

/** Derives a lock from the ECC working tree at its current HEAD. */
export function deriveEccLock(root: string, eccDir: string): EccLock {
  const commit = currentCommit(eccDir);
  const exactTag = currentExactTag(eccDir, commit);
  const ref = exactTag || describeCommit(eccDir, commit);
  return {
    repository: remoteUrl(eccDir),
    ref,
    commit,
    version: readVersionAt(eccDir, commit),
    updatedAt: new Date().toISOString(),
  };
}
