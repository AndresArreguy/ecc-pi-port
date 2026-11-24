/**
 * /ecc-models registration: the model selector must expose the new command
 * while keeping the legacy aliases working.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPin, loadAgentModels, saveAgentModels, setAgentPin } from "../../lib/ecc-agent-models.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

register(new URL("./stubs/pi-resolve-hooks.mjs", import.meta.url));

const { default: eccSddExtension } = await import("../../extensions/ecc-sdd.ts");

function makeFakePi() {
  const commands: Array<{ name: string; options: Record<string, unknown> }> = [];
  const events: string[] = [];
  const api = {
    on(name: string) {
      events.push(name);
    },
    registerCommand(name: string, options: Record<string, unknown>) {
      commands.push({ name, options });
    },
    registerTool() {},
  };
  return { api, commands, events };
}

test("ecc-sdd registers /ecc-models plus the legacy aliases", () => {
  const fake = makeFakePi();
  eccSddExtension(fake.api);

  const names = fake.commands.map((command) => command.name);
  for (const expected of [
    "ecc-models",
    "sdd-model",
    "sdd-models",
    "sdd-spec",
    "sdd-plan",
    "sdd-implement",
    "sdd-review",
    "sdd-verify",
  ]) {
    assert.ok(names.includes(expected), `${expected} should be registered`);
  }

  const primary = fake.commands.find((command) => command.name === "ecc-models");
  assert.ok(primary, "ecc-models is the primary command");
  assert.match(String(primary.options.description), /subagent/i);
  assert.equal(typeof primary.options.handler, "function");

  for (const alias of ["sdd-model", "sdd-models"]) {
    const entry = fake.commands.find((command) => command.name === alias);
    assert.match(String(entry?.options.description), /alias/i);
    assert.equal(entry?.options.handler, primary.options.handler, "aliases share the handler");
  }
});

test("CLI save/load round-trips phases and agent pins without touching the repo config", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-models-cli-"));
  const sddPath = path.join(dir, "sdd-models.json");
  const agentsPath = path.join(dir, "agents-models.json");
  fs.copyFileSync(path.join(ROOT, "config", "sdd-models.json"), sddPath);
  fs.copyFileSync(path.join(ROOT, "config", "agents-models.json"), agentsPath);

  const previous = {
    sdd: process.env.ECC_PI_SDD_CONFIG,
    agents: process.env.ECC_PI_AGENT_MODELS,
  };
  process.env.ECC_PI_SDD_CONFIG = sddPath;
  process.env.ECC_PI_AGENT_MODELS = agentsPath;

  try {
    const fake = makeFakePi();
    eccSddExtension(fake.api);
    const handler = fake.commands.find((command) => command.name === "ecc-models")?.options.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    assert.equal(typeof handler, "function");

    const notes: string[] = [];
    const ctx = { cwd: ROOT, ui: { notify: (message: string) => notes.push(message) } };

    // No UI: the command falls back to the config summary instead of a menu.
    await handler("", ctx);
    assert.ok(notes.some((note) => /fases|phases/i.test(note)), "summary mentions phases");

    await handler("tdd-guide clear", ctx);
    await handler("save smoke", ctx);

    // Mutate the pin after the profile was snapshotted.
    const file = loadAgentModels(agentsPath);
    setAgentPin(file, "planner", { provider: "acme", model: "big-model", thinking: "high" });
    saveAgentModels(file, agentsPath);
    assert.equal(agentPin(loadAgentModels(agentsPath), "planner").model, "big-model");

    await handler("load smoke", ctx);
    const reloaded = loadAgentModels(agentsPath);
    assert.equal(
      agentPin(reloaded, "planner").model,
      null,
      "loading the profile restores the snapshotted (empty) pin",
    );
  } finally {
    if (previous.sdd === undefined) delete process.env.ECC_PI_SDD_CONFIG;
    else process.env.ECC_PI_SDD_CONFIG = previous.sdd;
    if (previous.agents === undefined) delete process.env.ECC_PI_AGENT_MODELS;
    else process.env.ECC_PI_AGENT_MODELS = previous.agents;
  }
});
