/**
 * Delegation routing: intent → agent must be shipped with the tool, and every
 * agent named there must exist in the generated subset. This is the guard that
 * catches a renamed agent (or a route pointing at nothing) before the model
 * tries to delegate to it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_ROUTES,
  DELEGATION_RULES,
  renderRoutingGuidance,
  routedAgentNames,
} from "../../lib/ecc-agent-routing.ts";
import eccAgentsExtension from "../../extensions/ecc-agents.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function generatedAgentNames(): string[] {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "agents-generated.json"), "utf8")) as {
    agents: Array<{ name: string }>;
  };
  return raw.agents.map((agent) => agent.name);
}

function allowlist() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "commands-allowlist.json"), "utf8")) as {
    commands: Array<{ name: string; status: string; dependencies?: string[]; adaptations?: string[] }>;
  };
}

function generatedPrompt(name: string): string {
  return fs.readFileSync(path.join(ROOT, "prompts", `${name}.md`), "utf8");
}

function makeFakePi() {
  const tools: Array<Record<string, unknown>> = [];
  const api = {
    on() {},
    registerCommand() {},
    registerTool(definition: Record<string, unknown>) {
      tools.push(definition);
    },
  };
  return { api, tools };
}

test("every routed agent exists in the generated subset", () => {
  const available = new Set(generatedAgentNames());
  const missing = routedAgentNames().filter((name) => !available.has(name));
  assert.deepEqual(missing, [], `routes reference unknown agents: ${missing.join(", ")}`);
});

test("routes cover the intent the workflow depends on", () => {
  const ids = AGENT_ROUTES.map((route) => route.id);
  for (const expected of [
    "plan",
    "feature",
    "bug",
    "build",
    "review",
    "security",
    "cleanup",
    "performance",
    "a11y",
    "tests",
    "docs",
    "ship",
  ]) {
    assert.ok(ids.includes(expected), `missing route: ${expected}`);
  }
});

test("routes are well formed: triggers, agents and a note each", () => {
  for (const route of AGENT_ROUTES) {
    assert.ok(route.triggers.length > 0, `${route.id} has no triggers`);
    assert.ok(route.agents.length > 0, `${route.id} has no agents`);
    assert.ok(route.note.trim().length > 0, `${route.id} has no note`);
    assert.ok(route.triggers.every((trigger) => trigger === trigger.toLowerCase()), `${route.id} triggers must be lowercase`);
  }
  assert.ok(DELEGATION_RULES.length >= 3, "delegation rules should cover the real failure modes");
});

test("rendered guidance stays small and names the agents in order", () => {
  const lines = renderRoutingGuidance();
  assert.ok(lines.length <= 22, `routing block is too long for a per-turn prompt: ${lines.length} lines`);
  const block = lines.join("\n");
  for (const route of AGENT_ROUTES) {
    assert.ok(block.includes(route.agents.join(" → ")), `route ${route.id} is not rendered in order`);
  }
  assert.match(block, /one-line change or typo stays inline/i);
  assert.match(block, /two agents never write the same file/i);
  assert.match(block, /run it yourself before reporting anything as done/i);
});

test("run_agent ships the routing table in its prompt guidelines", () => {
  const fake = makeFakePi();
  eccAgentsExtension(fake.api as never);
  const tool = fake.tools.find((definition) => definition.name === "run_agent");
  assert.ok(tool, "run_agent tool is registered");

  const guidelines = (tool.promptGuidelines as string[]) || [];
  const block = guidelines.join("\n");
  assert.match(block, /Delegation routing/i);
  for (const route of AGENT_ROUTES) {
    assert.ok(block.includes(route.agents[0]), `guidelines do not mention ${route.agents[0]}`);
  }
});

test("commands that delegate declare the run_agent dependency", () => {
  const config = allowlist();
  const delegating = ["plan", "feature-dev", "code-review", "test-coverage", "prp-implement"];
  for (const name of delegating) {
    const command = config.commands.find((entry) => entry.name === name);
    assert.ok(command, `${name} missing from the allowlist`);
    assert.ok(
      (command.dependencies || []).includes("run_agent"),
      `${name} should declare run_agent in dependencies`,
    );
  }
  const featureDev = config.commands.find((entry) => entry.name === "feature-dev");
  assert.equal(featureDev?.status, "ready", "feature-dev is no longer degraded");
});

test("generated prompts route to agents and carry no anti-delegation leftovers", () => {
  const forbidden = [/Do not call the .*subagent/i, /unavailable in core Pi/i, /degradado respecto/i];
  for (const name of ["plan", "feature-dev", "code-review", "test-coverage", "prp-implement", "quality-gate"]) {
    const prompt = generatedPrompt(name);
    assert.match(prompt, /run_agent/, `${name} should mention run_agent`);
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(prompt), `${name} still contains ${pattern}`);
    }
  }

  assert.match(generatedPrompt("plan"), /agent: "planner"/);
  const featureDev = generatedPrompt("feature-dev");
  for (const agent of ["code-explorer", "architect", "tdd-guide", "code-reviewer"]) {
    assert.ok(featureDev.includes(agent), `feature-dev prompt should route to ${agent}`);
  }
  assert.match(generatedPrompt("test-coverage"), /pr-test-analyzer/);
  assert.match(generatedPrompt("prp-implement"), /tdd-guide/);
  assert.match(generatedPrompt("quality-gate"), /build-error-resolver/);
});
