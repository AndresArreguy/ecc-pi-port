/**
 * /ecc-models data layer: subagent pins live next to runtime limits in
 * config/agents-models.json, and profiles snapshot both phases and pins.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentPin,
  agentPinLabel,
  agentRoster,
  applyAgentPins,
  hasAgentPin,
  loadAgentModels,
  loadAgentNames,
  saveAgentModels,
  setAgentPin,
  snapshotAgentPins,
} from "../../lib/ecc-agent-models.ts";
import {
  applyProfile,
  createDefaultConfig,
  normalizeConfig,
  saveProfile,
} from "../../lib/ecc-sdd-config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function tempFilePath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-models-"));
  return path.join(dir, name);
}

function sampleConfig() {
  return {
    description: "test",
    defaults: { maxTurns: 25, timeoutMs: 600000, maxParallel: 3 },
    agents: {
      "tdd-guide": { model: null, provider: null, thinking: null, maxTurns: 40, timeoutMs: 900000 },
      "code-simplifier": { model: "x", provider: "p", thinking: "high", comment: "keep me" },
    },
  };
}

test("setAgentPin keeps limits, comment and unknown keys", () => {
  const cfg = sampleConfig();
  setAgentPin(cfg, "tdd-guide", { provider: "anthropic", model: "sonnet", thinking: "low" });
  const entry = cfg.agents["tdd-guide"];
  assert.equal(entry.provider, "anthropic");
  assert.equal(entry.model, "sonnet");
  assert.equal(entry.thinking, "low");
  assert.equal(entry.maxTurns, 40);
  assert.equal(entry.timeoutMs, 900000);
  assert.equal(cfg.agents["code-simplifier"].comment, "keep me");
  assert.deepEqual(cfg.defaults, { maxTurns: 25, timeoutMs: 600000, maxParallel: 3 });
});

test("setAgentPin creates an entry for an agent that had no pin", () => {
  const cfg = sampleConfig();
  setAgentPin(cfg, "planner", { provider: "openai", model: "gpt-5", thinking: null });
  assert.equal(cfg.agents["planner"].model, "gpt-5");
  assert.equal(cfg.agents["planner"].thinking, null);
});

test("saveAgentModels round-trips through disk and survives reload", () => {
  const file = tempFilePath("agents-models.json");
  const cfg = sampleConfig();
  setAgentPin(cfg, "planner", { provider: "openai", model: "gpt-5" });
  saveAgentModels(cfg as any, file);
  const reloaded = loadAgentModels(file);
  assert.equal(agentPin(reloaded, "planner").model, "gpt-5");
  assert.equal(reloaded.agents?.["tdd-guide"].maxTurns, 40);
  assert.equal(reloaded.defaults?.maxParallel, 3);
  assert.ok(fs.readFileSync(file, "utf8").endsWith("\n"));
});

test("loadAgentModels returns an empty roster for a missing or broken file", () => {
  const missing = loadAgentModels(path.join(os.tmpdir(), "does-not-exist", "agents-models.json"));
  assert.deepEqual(missing.agents, {});
  const broken = tempFilePath("broken.json");
  fs.writeFileSync(broken, "{ not json");
  assert.deepEqual(loadAgentModels(broken).agents, {});
});

test("agentRoster unions the generated roster with local entries, sorted", () => {
  const cfg = { agents: { zeta: { model: "m" }, alpha: {} } };
  assert.deepEqual(agentRoster(cfg as any, ["tdd-guide", "alpha"]), ["alpha", "tdd-guide", "zeta"]);
});

test("snapshotAgentPins covers every roster name, empty pins included", () => {
  const cfg = sampleConfig();
  const pins = snapshotAgentPins(cfg as any, ["tdd-guide", "code-simplifier", "planner"]);
  assert.deepEqual(Object.keys(pins), ["tdd-guide", "code-simplifier", "planner"]);
  assert.equal(pins["tdd-guide"].model, null);
  assert.equal(pins["code-simplifier"].model, "x");
  assert.deepEqual(pins["planner"], {});
});

test("applyAgentPins writes listed agents and leaves the rest untouched", () => {
  const cfg = sampleConfig();
  const applied = applyAgentPins(cfg as any, {
    "tdd-guide": { provider: "anthropic", model: "opus" },
    planner: { provider: "openai", model: "gpt-5" },
  });
  assert.equal(applied, 2);
  assert.equal(cfg.agents["tdd-guide"].model, "opus");
  assert.equal(cfg.agents["tdd-guide"].maxTurns, 40, "limits survive a profile apply");
  assert.equal(cfg.agents["code-simplifier"].model, "x", "unlisted agent keeps its pin");
  assert.equal(applyAgentPins(cfg as any, undefined), 0);
});

test("agentPinLabel and hasAgentPin describe inheritance", () => {
  assert.equal(agentPinLabel({ provider: "p", model: "m" }), "p/m");
  assert.equal(agentPinLabel({ model: "m" }), "m");
  assert.equal(agentPinLabel({}), "");
  assert.equal(hasAgentPin({ thinking: "high" }), true);
  assert.equal(hasAgentPin({ provider: null, model: "", thinking: null }), false);
});

test("saveProfile stores agent pins and applyProfile hands them back", () => {
  const cfg = createDefaultConfig();
  cfg.phases = { spec: { provider: "p", model: "m" } };
  const pins = { "tdd-guide": { provider: "anthropic", model: "opus", thinking: "high" } };
  const saved = saveProfile(cfg, "WithAgents", cfg.phases, undefined, pins);
  assert.equal(saved.ok, true);
  assert.deepEqual(cfg.profiles?.["WithAgents"].agents, pins);

  pins["tdd-guide"].model = "mutated";
  assert.equal(cfg.profiles?.["WithAgents"].agents?.["tdd-guide"].model, "opus", "snapshot is isolated");

  const applied = applyProfile(cfg, "WithAgents");
  assert.equal(applied.ok, true);
  assert.equal(applied.agents?.["tdd-guide"].model, "opus");
});

test("applyProfile returns no agents key for phase-only profiles", () => {
  const cfg = createDefaultConfig();
  cfg.phases = { spec: { provider: "p", model: "m" } };
  saveProfile(cfg, "PhasesOnly", cfg.phases);
  const applied = applyProfile(cfg, "PhasesOnly");
  assert.equal(applied.ok, true);
  assert.equal("agents" in applied, false);
});

test("normalizeConfig keeps profile agent pins and ignores garbage inside", () => {
  const raw = {
    phases: { spec: { provider: "p", model: "m" } },
    profiles: {
      Mixed: {
        phases: { spec: { provider: "p", model: "m" } },
        agents: {
          "tdd-guide": { provider: "anthropic", model: "opus", maxTurns: 999 },
          bad: "nope",
          "code-simplifier": { model: "  x  " },
        },
      },
    },
  };
  const cfg = normalizeConfig(raw);
  const stored = cfg.profiles?.Mixed.agents;
  assert.equal(stored?.["tdd-guide"].model, "opus");
  assert.equal((stored?.["tdd-guide"] as Record<string, unknown>).maxTurns, undefined, "limits are never snapshotted");
  assert.equal(stored?.["code-simplifier"].model, "x");
  assert.deepEqual(stored?.bad, {});
});

test("loadAgentNames reads the generated subset from the repo config", () => {
  const names = loadAgentNames(path.join(ROOT, "config", "agents-generated.json"));
  assert.ok(names.length >= 60, `expected the full subset, got ${names.length}`);
  assert.ok(names.includes("tdd-guide"));
  assert.ok(names.includes("code-reviewer"));
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b)), names, "roster is sorted");
});
