import fs from "node:fs";
import path from "node:path";

export interface CopyStats {
  files: number;
  dirs: number;
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function resetDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export function listDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Recursively lists files below `dir` as POSIX-style relative paths, sorted. Rejects symlinks. */
export function listFilesRelative(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink not allowed in generated content: ${rel}`);
    }
    if (entry.isDirectory()) {
      out.push(...listFilesRelative(full, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/** Recursively copies a directory, preserving relative paths. */
export function copyDir(srcDir: string, destDir: string): CopyStats {
  let files = 0;
  let dirs = 0;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink not allowed in generated content: ${src}`);
    }
    if (entry.isDirectory()) {
      const stats = copyDir(src, dest);
      files += stats.files;
      dirs += stats.dirs + 1;
    } else if (entry.isFile()) {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      files += 1;
    }
  }
  return { files, dirs };
}

/** Returns a sorted list of `relative-path` entries that differ between two directory trees. */
export function diffDirs(expectedDir: string, actualDir: string): string[] {
  if (!fs.existsSync(actualDir)) return ["<missing directory>"];
  const expected = listFilesRelative(expectedDir);
  const expectedSet = new Set(expected);
  const actual = listFilesRelative(actualDir);
  const actualSet = new Set(actual);
  const diffs: string[] = [];
  for (const rel of expected) {
    if (!actualSet.has(rel)) {
      diffs.push(`missing: ${rel}`);
      continue;
    }
    const a = fs.readFileSync(path.join(expectedDir, rel));
    const b = fs.readFileSync(path.join(actualDir, rel));
    if (!a.equals(b)) diffs.push(`changed: ${rel}`);
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) diffs.push(`unexpected: ${rel}`);
  }
  return diffs.sort();
}
