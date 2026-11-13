import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, listDirNames, listFilesRelative, readJson, resetDir } from "./fs-utils.ts";
import { parseFrontmatter, renameFrontmatterName } from "./frontmatter.ts";
import { listOverlaySkills, overlaySkillDir } from "./overlays.ts";

interface PiCoreManifest {
  skills: {
    include: string[];
    exclude: Record<string, string>;
    rename?: Record<string, string>;
  };
}

export interface GenerateSkillsOptions {
  eccRoot: string;
  outRoot: string;
  /** Defaults to `<eccRoot>/manifests/pi-core.json`, ECC's own curation manifest. */
  manifestPath?: string;
  /** Optional overlays root; defaults to `<outRoot>/overlays`. */
  overlaysRoot?: string;
}

export interface GenerateSkillsResult {
  copied: number;
  files: number;
  renamed: Array<{ from: string; to: string }>;
  overlays: Array<{ skill: string; target: string; path: string }>;
  warnings: string[];
}

/**
 * Regenerates `skills/` from ECC's curated Pi profile manifest
 * (`ecc/manifests/pi-core.json`). The manifest classifies every on-disk skill
 * exactly once, so new ECC skills fail the build until curation is updated.
 */
export function generateSkills(options: GenerateSkillsOptions): GenerateSkillsResult {
  const eccRoot = path.resolve(options.eccRoot);
  const outSkills = path.join(path.resolve(options.outRoot), "skills");
  const manifestPath = options.manifestPath ?? path.join(eccRoot, "manifests", "pi-core.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`ECC curation manifest not found: ${manifestPath}`);

  const manifest = readJson<PiCoreManifest>(manifestPath);
  const include = manifest.skills?.include ?? [];
  const exclude = manifest.skills?.exclude ?? {};
  const rename = manifest.skills?.rename ?? {};
  if (include.length === 0) throw new Error(`No skills listed in ${manifestPath}`);

  const skillsSrc = path.join(eccRoot, "skills");
  const onDisk = listDirNames(skillsSrc);
  const classified = new Set([...include, ...Object.keys(exclude)]);
  const drift: string[] = [];
  for (const dir of onDisk) {
    if (!classified.has(dir)) drift.push(`skills/${dir} is not classified in pi-core.json`);
  }
  for (const name of classified) {
    if (!onDisk.includes(name)) drift.push(`pi-core.json references missing skills/${name}`);
  }
  if (drift.length > 0) {
    throw new Error(`ECC skill curation drift:\n- ${drift.join("\n- ")}`);
  }

  resetDir(outSkills);
  ensureDir(outSkills);

  const warnings: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const usedOverlays: Array<{ skill: string; target: string; path: string }> = [];
  const overlaysRoot = path.resolve(options.overlaysRoot ?? path.join(path.resolve(options.outRoot), "overlays"));
  const activeOverlays = listOverlaySkills(overlaysRoot);
  for (const overlay of activeOverlays) {
    if (!include.includes(overlay) && !Object.values(rename).includes(overlay)) {
      warnings.push(`overlays/skills/${overlay} no coincide con ninguna skill curada de ECC; se ignora.`);
    }
  }
  const seen = new Map<string, string>();
  let files = 0;

  for (const dirName of include) {
    const targetName = rename[dirName] ?? dirName;
    const overlayDir = overlaySkillDir(overlaysRoot, [dirName, targetName]);
    const sourceDir = overlayDir ?? path.join(skillsSrc, dirName);
    const targetDir = path.join(outSkills, targetName);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Skill source not found for ${dirName}: ${sourceDir}`);
    }
    if (seen.has(targetName)) {
      throw new Error(`Duplicate skill name after rename: ${targetName} (${seen.get(targetName)} and ${dirName})`);
    }
    seen.set(targetName, dirName);

    copyDir(sourceDir, targetDir);
    files += listFilesRelative(targetDir).length;

    const skillFile = path.join(targetDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      throw new Error(`Skill ${dirName} has no SKILL.md${overlayDir ? ` (overlay: ${overlayDir})` : ""}`);
    }
    const source = fs.readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(source);
    if (!fm.data.description) {
      throw new Error(`Skill ${dirName} has no description in SKILL.md frontmatter`);
    }
    if (fm.data.description.length > 1024) {
      warnings.push(`Skill ${dirName} description exceeds 1024 chars (${fm.data.description.length}).`);
    }
    if (overlayDir && fm.data.name && fm.data.name !== dirName && fm.data.name !== targetName) {
      throw new Error(
        `Overlay for ${dirName} declares name "${fm.data.name}"; expected "${dirName}" or "${targetName}" (${overlayDir})`,
      );
    }

    if (targetName !== dirName) {
      const updated = renameFrontmatterName(source, targetName);
      if (updated !== source) fs.writeFileSync(skillFile, updated, "utf8");
      renamed.push({ from: dirName, to: targetName });
    }

    if (overlayDir) {
      usedOverlays.push({
        skill: dirName,
        target: targetName,
        path: path.relative(path.resolve(options.outRoot), overlayDir).replace(/\\/g, "/"),
      });
    }

    const declaredName = parseFrontmatter(fs.readFileSync(skillFile, "utf8")).data.name;
    if (declaredName && declaredName !== targetName) {
      throw new Error(
        `Skill ${targetName} declares name "${declaredName}"${overlayDir ? ` (overlay: ${overlayDir})` : ""}`,
      );
    }
  }

  return { copied: include.length, files, renamed, overlays: usedOverlays, warnings };
}
