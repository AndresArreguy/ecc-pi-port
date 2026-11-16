import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyProfile,
  createDefaultConfig,
  deepClonePhases,
  deleteProfile,
  formatConfigSummary,
  listProfiles,
  normalizeConfig,
  phaseList,
  profileSummary,
  resolvePhase,
  saveProfile,
  validateProfileName,
} from "../../lib/ecc-sdd-config.ts";
import { createTranslator } from "../../lib/ecc-sdd-i18n.ts";

const t = createTranslator("es");

test("normalizeConfig keeps known fields and drops garbage", () => {
  const cfg = normalizeConfig({
    description: "custom",
    language: "en",
    activeProfile: "  Fast  ",
    phases: {
      spec: { provider: "commandcode", model: "m", thinking: "high", tier: "strong", notes: "n" },
      plan: { provider: null, model: null, thinking: null },
      bogus: "nope",
    },
    phaseAliases: { architecture: "plan", broken: 3 },
    profiles: {
      Fast: { updatedAt: "2026-01-01T00:00:00.000Z", phases: { spec: { provider: "p", model: "m" } } },
      broken: "nope",
    },
  });

  assert.equal(cfg.description, "custom");
  assert.equal(cfg.language, "en");
  assert.equal(cfg.activeProfile, "Fast");
  assert.deepEqual(phaseList(cfg), ["spec", "plan"]);
  assert.equal(cfg.phases.spec.tier, "strong");
  assert.equal(cfg.phases.plan.provider, null);
  assert.equal(cfg.phaseAliases?.architecture, "plan");
  assert.equal(cfg.phaseAliases?.broken, undefined);
  assert.ok(cfg.profiles?.Fast);
  assert.equal(cfg.profiles?.broken, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.profiles, "__proto__"), false);
  assert.equal(resolvePhase(cfg, "architecture"), "plan");
  assert.equal(resolvePhase(cfg, "SPEC"), "spec");
  assert.equal(resolvePhase(cfg, "missing"), null);

  const empty = normalizeConfig(null);
  assert.deepEqual(empty.phases, {});
  assert.deepEqual(empty.phaseAliases, {});
  assert.deepEqual(empty.profiles, {});
  assert.equal(empty.activeProfile, null);
  assert.equal(empty.language, "auto");
  assert.equal(normalizeConfig({ language: "fr" }).language, "auto");
});

test("deepClonePhases is independent from the source map", () => {
  const source = { spec: { provider: "p", model: "m", thinking: "low" } };
  const clone = deepClonePhases(source);
  clone.spec.model = "changed";
  assert.equal(source.spec.model, "m");
});

test("saveProfile stores a named snapshot and isolates it from later edits", () => {
  const cfg = createDefaultConfig();
  const result = saveProfile(
    cfg,
    "  Modo barato  ",
    { spec: { provider: "commandcode", model: "cheap", thinking: "low" } },
    "2026-01-01T00:00:00.000Z",
  );

  assert.equal(result.ok, true);
  assert.equal(result.key, "Modo barato");
  assert.equal(cfg.activeProfile, "Modo barato");
  assert.deepEqual(listProfiles(cfg), ["Modo barato"]);
  assert.equal(cfg.profiles?.["Modo barato"].updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(cfg.profiles?.["Modo barato"].phases.spec.model, "cheap");

  cfg.phases.spec = { provider: "other", model: "other" };
  assert.equal(cfg.profiles?.["Modo barato"].phases.spec.model, "cheap");

  const overwritten = saveProfile(
    cfg,
    "modo barato",
    { spec: { provider: "p", model: "new" } },
    "2026-02-02T00:00:00.000Z",
  );
  assert.equal(overwritten.ok, true);
  assert.equal(overwritten.key, "Modo barato");
  assert.deepEqual(listProfiles(cfg), ["Modo barato"]);
  assert.equal(cfg.profiles?.["Modo barato"].phases.spec.model, "new");
  assert.equal(cfg.profiles?.["Modo barato"].updatedAt, "2026-02-02T00:00:00.000Z");
});

test("applyProfile merges phases and marks the active profile", () => {
  const cfg = createDefaultConfig();
  cfg.phases = {
    spec: { provider: "old", model: "old", thinking: "high" },
    plan: { provider: "keep", model: "keep" },
  };
  saveProfile(cfg, "A", { spec: { provider: "p", model: "m", thinking: "low" } });

  const applied = applyProfile(cfg, "a");
  assert.equal(applied.ok, true);
  assert.equal(applied.key, "A");
  assert.equal(cfg.phases.spec?.model, "m");
  assert.equal(cfg.phases.spec?.thinking, "low");
  assert.equal(cfg.phases.plan?.model, "keep");
  assert.equal(cfg.activeProfile, "A");

  const missing = applyProfile(cfg, "does-not-exist");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "profile-not-found");
});

test("deleteProfile removes a profile and clears it when active", () => {
  const cfg = createDefaultConfig();
  saveProfile(cfg, "One", { spec: { provider: "p", model: "m" } });
  saveProfile(cfg, "Two", { spec: { provider: "p", model: "m" } });

  const removed = deleteProfile(cfg, "one");
  assert.equal(removed.ok, true);
  assert.deepEqual(listProfiles(cfg), ["Two"]);
  assert.equal(cfg.activeProfile, "Two");

  const activeRemoved = deleteProfile(cfg, "Two");
  assert.equal(activeRemoved.ok, true);
  assert.equal(cfg.activeProfile, null);

  const again = deleteProfile(cfg, "Two");
  assert.equal(again.ok, false);
  assert.equal(again.code, "profile-not-found");
});

test("validateProfileName rejects empty, separators and overlong names", () => {
  assert.equal(validateProfileName("   ").ok, false);
  assert.equal(validateProfileName("a/b").ok, false);
  assert.equal(validateProfileName("a\\b").ok, false);
  assert.equal(validateProfileName("x".repeat(61)).ok, false);
  assert.equal(validateProfileName("__proto__").ok, false);
  assert.equal(validateProfileName("constructor").ok, false);

  const valid = validateProfileName("  Plan   rápido 2  ");
  assert.equal(valid.ok, true);
  assert.equal(valid.name, "Plan rápido 2");
});

test("profileSummary and formatConfigSummary describe profiles and phases", () => {
  const cfg = createDefaultConfig();
  cfg.phases = { spec: { provider: "commandcode", model: "m", thinking: "high" } };
  saveProfile(cfg, "Fast", {
    spec: { provider: "commandcode", model: "cheap", thinking: "low" },
    implement: { provider: "commandcode", model: "cheap" },
  });

  const summary = profileSummary(cfg, "Fast", t);
  assert.match(summary, /2 fases/);
  assert.match(summary, /spec=commandcode\/cheap \(low\)/);
  assert.match(summary, /implement=commandcode\/cheap/);

  const full = formatConfigSummary(cfg, t);
  assert.match(full, /Perfil activo: Fast/);
  assert.match(full, /Perfiles guardados: Fast/);
  assert.match(full, /- spec: provider=commandcode model=m thinking=high/);
});

test("shipped SDD config has the profile fields and all phases", () => {
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "sdd-models.json");
  const cfg = normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  assert.ok(cfg.activeProfile === null || typeof cfg.activeProfile === "string");
  assert.equal(typeof cfg.profiles, "object");
  assert.equal(cfg.language, "auto");
  for (const phase of ["spec", "plan", "implement", "review", "verify", "light"]) {
    assert.ok(cfg.phases[phase], `missing phase ${phase}`);
  }
});
