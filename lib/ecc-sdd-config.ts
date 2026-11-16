/**
 * Pure config/profile helpers for the SDD model selector.
 *
 * Kept separate from `extensions/ecc-sdd.ts` so profile semantics can be
 * tested without a TUI or a Pi session.
 */

import { isSddLanguage, type SddLanguage, type Translator } from "./ecc-sdd-i18n.ts";

export interface PhaseModelConfig {
  provider?: string | null;
  model?: string | null;
  thinking?: string | null;
  tier?: string;
  notes?: string;
}

export interface SddProfile {
  updatedAt?: string;
  phases: Record<string, PhaseModelConfig>;
}

export interface SddModelsConfig {
  description?: string;
  language?: SddLanguage;
  activeProfile?: string | null;
  phases: Record<string, PhaseModelConfig>;
  phaseAliases?: Record<string, string>;
  profiles?: Record<string, SddProfile>;
}

export const DEFAULT_CONFIG_DESCRIPTION =
  "Model configuration for ECC SDD (spec-driven development) phases in Pi. Set provider/model/thinking per phase; values are not hardcoded. Use /sdd-model to view/update.";

export const THINKING_VALUES = ["null", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const MAX_PROFILE_NAME_LENGTH = 60;

const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isReservedKey(key: string): boolean {
  return RESERVED_OBJECT_KEYS.has(key.toLowerCase());
}

export type ProfileErrorCode =
  | "name-empty"
  | "name-too-long"
  | "name-invalid-chars"
  | "name-reserved"
  | "profile-not-found";

export interface ProfileResult {
  ok: boolean;
  key?: string;
  code?: ProfileErrorCode;
}

export interface ProfileNameValidation {
  ok: boolean;
  name: string;
  code?: ProfileErrorCode;
}

export function createDefaultConfig(): SddModelsConfig {
  return {
    description: DEFAULT_CONFIG_DESCRIPTION,
    language: "auto",
    activeProfile: null,
    phases: {},
    phaseAliases: {},
    profiles: {},
  };
}

function sanitizePhase(raw: unknown): PhaseModelConfig {
  const out: PhaseModelConfig = {};
  if (!raw || typeof raw !== "object") return out;
  const source = raw as Record<string, unknown>;
  for (const key of ["provider", "model", "thinking"] as const) {
    const value = source[key];
    if (value === null) out[key] = null;
    else if (typeof value === "string") out[key] = value.trim() || null;
  }
  if (typeof source.tier === "string") out.tier = source.tier;
  if (typeof source.notes === "string") out.notes = source.notes;
  return out;
}

function sanitizePhases(raw: unknown): Record<string, PhaseModelConfig> {
  const out: Record<string, PhaseModelConfig> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [phase, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = phase.trim();
    if (!key || isReservedKey(key)) continue;
    if (!value || typeof value !== "object") continue;
    out[key] = sanitizePhase(value);
  }
  return out;
}

/** Normalize a parsed JSON document into a usable config without losing phases. */
export function normalizeConfig(raw: unknown): SddModelsConfig {
  const cfg = createDefaultConfig();
  if (!raw || typeof raw !== "object") return cfg;

  const source = raw as Record<string, unknown>;
  if (typeof source.description === "string" && source.description.trim()) {
    cfg.description = source.description;
  }
  const language = String(source.language ?? "").trim().toLowerCase();
  cfg.language = isSddLanguage(language) ? language : "auto";
  if (source.activeProfile === null) cfg.activeProfile = null;
  else if (typeof source.activeProfile === "string" && source.activeProfile.trim()) {
    cfg.activeProfile = source.activeProfile.trim();
  }

  cfg.phases = sanitizePhases(source.phases);

  if (source.phaseAliases && typeof source.phaseAliases === "object") {
    for (const [alias, target] of Object.entries(source.phaseAliases as Record<string, unknown>)) {
      if (typeof target === "string" && target.trim()) {
        const aliasKey = alias.trim();
        if (aliasKey && !isReservedKey(aliasKey)) cfg.phaseAliases![aliasKey] = target.trim();
      }
    }
  }

  if (source.profiles && typeof source.profiles === "object") {
    for (const [name, value] of Object.entries(source.profiles as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const profileSource = value as Record<string, unknown>;
      const phases = sanitizePhases(profileSource.phases);
      if (Object.keys(phases).length === 0) continue;
      const key = name.trim();
      if (!key || isReservedKey(key)) continue;
      cfg.profiles![key] = {
        ...(typeof profileSource.updatedAt === "string" ? { updatedAt: profileSource.updatedAt } : {}),
        phases,
      };
    }
  }

  return cfg;
}

/** Deep-copy a phase map so a saved profile never aliases live config. */
export function deepClonePhases(phases: Record<string, PhaseModelConfig>): Record<string, PhaseModelConfig> {
  return structuredClone(phases);
}

export function phaseList(cfg: SddModelsConfig): string[] {
  return Object.keys(cfg.phases || {});
}

export function resolvePhase(cfg: SddModelsConfig, input: string): string | null {
  const key = String(input || "").trim().toLowerCase();
  if (!key) return null;
  if (cfg.phases?.[key]) return key;
  const alias = cfg.phaseAliases?.[key];
  if (alias && cfg.phases?.[alias]) return alias;
  return null;
}

export function validateProfileName(name: string): ProfileNameValidation {
  const normalized = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return { ok: false, name: normalized, code: "name-empty" };
  if (normalized.length > MAX_PROFILE_NAME_LENGTH) {
    return { ok: false, name: normalized, code: "name-too-long" };
  }
  if (/[\/\\\x00-\x1f]/.test(normalized)) {
    return { ok: false, name: normalized, code: "name-invalid-chars" };
  }
  if (isReservedKey(normalized)) {
    return { ok: false, name: normalized, code: "name-reserved" };
  }
  return { ok: true, name: normalized };
}

/** Case-insensitive lookup that returns the stored key casing. */
export function findProfileKey(cfg: SddModelsConfig, name: string): string | null {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted || !cfg.profiles) return null;
  for (const key of Object.keys(cfg.profiles)) {
    if (key.toLowerCase() === wanted) return key;
  }
  return null;
}

export function listProfiles(cfg: SddModelsConfig): string[] {
  return Object.keys(cfg.profiles || {}).sort((a, b) => a.localeCompare(b));
}

/**
 * Save the given phases as a named profile. Overwrites an existing profile
 * whose name matches case-insensitively and activates the saved profile.
 */
export function saveProfile(
  cfg: SddModelsConfig,
  name: string,
  phases: Record<string, PhaseModelConfig>,
  now: string = new Date().toISOString(),
): ProfileResult {
  const valid = validateProfileName(name);
  if (!valid.ok) return { ok: false, code: valid.code };

  const existing = findProfileKey(cfg, valid.name);
  const key = existing ?? valid.name;
  if (!cfg.profiles) cfg.profiles = {};
  cfg.profiles[key] = {
    updatedAt: now,
    phases: deepClonePhases(phases),
  };
  cfg.activeProfile = key;
  return { ok: true, key };
}

/** Merge a saved profile into the live phases and mark it active. */
export function applyProfile(cfg: SddModelsConfig, name: string): ProfileResult {
  const key = findProfileKey(cfg, name);
  if (!key || !cfg.profiles?.[key]) {
    return { ok: false, code: "profile-not-found" };
  }
  const phases = deepClonePhases(cfg.profiles[key].phases);
  for (const [phase, phaseConfig] of Object.entries(phases)) {
    cfg.phases[phase] = { ...(cfg.phases[phase] || {}), ...phaseConfig };
  }
  cfg.activeProfile = key;
  return { ok: true, key };
}

export function deleteProfile(cfg: SddModelsConfig, name: string): ProfileResult {
  const key = findProfileKey(cfg, name);
  if (!key || !cfg.profiles?.[key]) {
    return { ok: false, code: "profile-not-found" };
  }
  delete cfg.profiles[key];
  if (cfg.activeProfile === key) cfg.activeProfile = null;
  return { ok: true, key };
}

function formatPhaseShort(phase: PhaseModelConfig, t: Translator): string {
  const provider = typeof phase.provider === "string" && phase.provider.trim() ? phase.provider.trim() : "";
  const model = typeof phase.model === "string" && phase.model.trim() ? phase.model.trim() : "";
  const thinking = typeof phase.thinking === "string" && phase.thinking.trim() ? phase.thinking.trim() : "";
  if (!provider && !model) return t("editor.overrideNone");
  const label = provider && model ? `${provider}/${model}` : model || provider;
  return thinking ? `${label} (${thinking})` : label;
}

/** Compact one-line description used in profile pickers. */
export function profileSummary(cfg: SddModelsConfig, name: string, t: Translator): string {
  const key = findProfileKey(cfg, name);
  if (!key || !cfg.profiles?.[key]) return t("profile.notFound", { name });
  const profile = cfg.profiles[key];
  const phases = Object.keys(profile.phases);
  const count = phases.length;
  const parts = [count === 1 ? t("profile.summaryOnePhase") : t("profile.summaryPhases", { count })];
  if (profile.phases.spec) parts.push(`spec=${formatPhaseShort(profile.phases.spec, t)}`);
  if (profile.phases.implement) parts.push(`implement=${formatPhaseShort(profile.phases.implement, t)}`);
  return parts.join(" · ");
}

export function formatConfigSummary(cfg: SddModelsConfig, t: Translator): string {
  const lines: string[] = [t("config.header")];
  lines.push(t("config.activeProfile", { name: cfg.activeProfile || t("config.none") }));
  for (const phase of phaseList(cfg)) {
    const p = cfg.phases[phase] || {};
    lines.push(
      `- ${phase}: provider=${p.provider ?? "null"} model=${p.model ?? "null"} thinking=${p.thinking ?? "null"} tier=${p.tier || ""}`,
    );
  }
  const aliases = Object.entries(cfg.phaseAliases || {});
  if (aliases.length) {
    lines.push(t("config.aliases", { list: aliases.map(([k, v]) => `${k}->${v}`).join(", ") }));
  }
  const profiles = listProfiles(cfg);
  lines.push(t("config.profiles", { list: profiles.length ? profiles.join(", ") : t("config.none") }));
  for (const name of profiles) {
    lines.push(t("config.profileLine", { name, summary: profileSummary(cfg, name, t) }));
  }
  return lines.join("\n");
}
