/**
 * Read/write helpers for `config/agents-models.json`.
 *
 * The file mixes two concerns: model pins (`provider`/`model`/`thinking`, which
 * the /ecc-models screen edits) and runtime limits (`maxTurns`/`timeoutMs`,
 * hand-edited and read by `extensions/ecc-agents.ts`). Every write here keeps
 * the limits and any unknown keys intact — the UI never owns those fields.
 *
 * The agent roster comes from `config/agents-generated.json` (the generated
 * subset), so an agent with no pin yet still shows up in the selector.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentModelPin } from "./ecc-sdd-config.ts";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config");

export const AGENT_MODELS_PATH = path.join(CONFIG_DIR, "agents-models.json");
export const AGENTS_GENERATED_PATH = path.join(CONFIG_DIR, "agents-generated.json");

/** Allow tests and power users to point the agent config somewhere else. */
export function agentModelsPath(): string {
  const override = process.env.ECC_PI_AGENT_MODELS?.trim();
  return override ? path.resolve(override) : AGENT_MODELS_PATH;
}

export const AGENT_PIN_FIELDS = ["provider", "model", "thinking"] as const;

export interface AgentModelsFile {
  description?: string;
  defaults?: Record<string, unknown>;
  agents?: Record<string, Record<string, unknown>>;
}

export function loadAgentModels(filePath: string = agentModelsPath()): AgentModelsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentModelsFile;
    if (!parsed || typeof parsed !== "object") return { agents: {} };
    if (!parsed.agents || typeof parsed.agents !== "object") parsed.agents = {};
    return parsed;
  } catch {
    return { agents: {} };
  }
}

export function saveAgentModels(cfg: AgentModelsFile, filePath: string = agentModelsPath()): void {
  fs.writeFileSync(filePath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

/** Names of every agent in the generated subset, sorted. */
export function loadAgentNames(filePath: string = AGENTS_GENERATED_PATH): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { agents?: Array<{ name?: unknown }> };
    const names = (parsed?.agents || [])
      .map((agent) => (typeof agent?.name === "string" ? agent.name.trim() : ""))
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Every agent the selector should show: generated roster plus any extra local entry. */
export function agentRoster(cfg: AgentModelsFile, roster: string[] = loadAgentNames()): string[] {
  const names = new Set(roster);
  for (const name of Object.keys(cfg.agents || {})) {
    const key = name.trim();
    if (key) names.add(key);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function pickPin(source: Record<string, unknown> | AgentModelPin | undefined): AgentModelPin {
  const out: AgentModelPin = {};
  if (!source) return out;
  const record = source as Record<string, unknown>;
  for (const field of AGENT_PIN_FIELDS) {
    const value = record[field];
    if (value === null) out[field] = null;
    else if (typeof value === "string") out[field] = value.trim() || null;
  }
  return out;
}

export function agentPin(cfg: AgentModelsFile, name: string): AgentModelPin {
  return pickPin(cfg.agents?.[name]);
}

/** Write one pin, keeping that agent's limits and comment untouched. */
export function setAgentPin(cfg: AgentModelsFile, name: string, pin: AgentModelPin): void {
  if (!cfg.agents) cfg.agents = {};
  const existing = cfg.agents[name] || {};
  cfg.agents[name] = { ...existing, ...pickPin(pin) };
}

/** Snapshot every pin in the file (used when saving a profile). */
export function snapshotAgentPins(cfg: AgentModelsFile, names: string[] = agentRoster(cfg)): Record<string, AgentModelPin> {
  const out: Record<string, AgentModelPin> = {};
  for (const name of names) out[name] = agentPin(cfg, name);
  return out;
}

/**
 * Apply profile pins. Listed agents are overwritten, agents absent from the
 * snapshot keep their current value, so an old profile cannot wipe new agents.
 * Returns how many pins were written.
 */
export function applyAgentPins(cfg: AgentModelsFile, pins: Record<string, AgentModelPin> | undefined): number {
  if (!pins) return 0;
  let count = 0;
  for (const [name, pin] of Object.entries(pins)) {
    const key = name.trim();
    if (!key) continue;
    setAgentPin(cfg, key, pin);
    count += 1;
  }
  return count;
}

export function hasAgentPin(pin: AgentModelPin): boolean {
  return Boolean(
    (typeof pin.provider === "string" && pin.provider.trim()) ||
      (typeof pin.model === "string" && pin.model.trim()) ||
      (typeof pin.thinking === "string" && pin.thinking.trim()),
  );
}

/** `provider/model`, `model`, or empty when the agent inherits the session default. */
export function agentPinLabel(pin: AgentModelPin): string {
  const provider = typeof pin.provider === "string" ? pin.provider.trim() : "";
  const model = typeof pin.model === "string" ? pin.model.trim() : "";
  if (provider && model) return `${provider}/${model}`;
  return model || provider;
}
