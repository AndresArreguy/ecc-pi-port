import fs from "node:fs";
import path from "node:path";

/**
 * Overlays let the port keep a local edit of a curated ECC skill.
 *
 * Layout:
 *   overlays/skills/<ecc-skill-dir>/SKILL.md   (same files a skill would have)
 *
 * The overlay replaces the ECC source directory during `npm run build`.
 * `npm run update-ecc` warns when the ECC base of an active overlay changed.
 */
export function overlaysSkillsDir(overlaysRoot: string): string {
  return path.join(overlaysRoot, "skills");
}

export function listOverlaySkills(overlaysRoot: string): string[] {
  const dir = overlaysSkillsDir(overlaysRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function overlaySkillDir(overlaysRoot: string, names: string[]): string | null {
  for (const name of names) {
    const dir = path.join(overlaysSkillsDir(overlaysRoot), name);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return dir;
  }
  return null;
}
