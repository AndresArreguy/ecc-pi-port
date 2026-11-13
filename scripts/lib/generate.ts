import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgents } from "./generate-agents.ts";
import { generatePrompts } from "./generate-prompts.ts";
import { generateRules } from "./generate-rules.ts";
import { generateSkills } from "./generate-skills.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default repository root (two levels above scripts/lib). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export interface GenerateAllOptions {
  eccRoot?: string;
  outRoot?: string;
  configRoot?: string;
  docsRoot?: string;
  overlaysRoot?: string;
  /** Ref from ecc.lock, stamped into generated agent data. */
  sourceRef?: string | null;
}

export interface GenerateAllResult {
  eccVersion: string;
  skills: { copied: number; files: number; overlays: number };
  rules: { stacks: number; files: number };
  prompts: { commands: number };
  agents: { agents: number };
  overlays: Array<{ skill: string; target: string; path: string }>;
  warnings: string[];
}

export function generateAll(options: GenerateAllOptions = {}): GenerateAllResult {
  const eccRoot = path.resolve(options.eccRoot ?? path.join(REPO_ROOT, "ecc"));
  const outRoot = path.resolve(options.outRoot ?? REPO_ROOT);
  const configRoot = path.resolve(options.configRoot ?? path.join(REPO_ROOT, "config"));
  const docsRoot = path.resolve(options.docsRoot ?? path.join(REPO_ROOT, "docs", "pi-port"));
  const overlaysRoot = path.resolve(options.overlaysRoot ?? path.join(outRoot, "overlays"));

  const warnings: string[] = [];

  const skills = generateSkills({ eccRoot, outRoot, overlaysRoot });
  warnings.push(...skills.warnings);

  const rules = generateRules({ eccRoot, outRoot });
  const prompts = generatePrompts({ eccRoot, configRoot, outRoot, docsRoot });
  const agents = generateAgents({ eccRoot, configRoot, outRoot, sourceRef: options.sourceRef });
  warnings.push(...agents.warnings);

  return {
    eccVersion: agents.version,
    skills: { copied: skills.copied, files: skills.files, overlays: skills.overlays.length },
    rules: { stacks: rules.stacks.length, files: rules.files },
    prompts: { commands: prompts.commands.length },
    agents: { agents: agents.agents.length },
    warnings,
  };
}
