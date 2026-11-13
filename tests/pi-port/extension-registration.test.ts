import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import eccAgentsExtension from "../../extensions/ecc-agents.ts";
import eccHooksExtension from "../../extensions/ecc-hooks.ts";
import eccRulesExtension from "../../extensions/ecc-rules.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECC_ROOT = path.join(ROOT, "ecc");

function makeFakePi() {
  const events = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const commands: Array<{ name: string; options: Record<string, unknown> }> = [];
  const tools: Array<Record<string, unknown>> = [];
  const api = {
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const list = events.get(name) ?? [];
      list.push(handler);
      events.set(name, list);
    },
    registerCommand(name: string, options: Record<string, unknown>) {
      commands.push({ name, options });
    },
    registerTool(definition: Record<string, unknown>) {
      tools.push(definition);
    },
  };
  return { api, events, commands, tools };
}

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("hooks extension registers the Pi lifecycle surface", () => {
  const fake = makeFakePi();
  eccHooksExtension(fake.api as never);
  for (const event of [
    "session_start",
    "session_shutdown",
    "session_before_compact",
    "tool_call",
    "tool_result",
    "agent_end",
    "before_agent_start",
  ]) {
    assert.equal(fake.events.get(event)?.length, 1, `missing handler for ${event}`);
  }
});

test("hooks adapter runs ECC pre-bash hook and blocks --no-verify", async () => {
  await withEnv({ ECC_HOOKS_ECC_ROOT: ECC_ROOT, ECC_HOOK_PROFILE: "standard" }, async () => {
    const fake = makeFakePi();
    eccHooksExtension(fake.api as never);
    const toolCall = fake.events.get("tool_call")![0];
    const ctx = { cwd: ROOT };

    const safe = (await toolCall(
      { toolName: "bash", toolCallId: "call-safe", input: { command: "echo hello" } },
      ctx,
    )) as { block?: boolean } | undefined;
    assert.equal(safe, undefined);

    const blocked = (await toolCall(
      { toolName: "bash", toolCallId: "call-blocked", input: { command: 'git commit -m "x" --no-verify' } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    assert.equal(blocked?.block, true);
    assert.match(String(blocked?.reason), /BLOCKED/i);
  });
});

test("hooks adapter honors ECC_DISABLED_HOOKS", async () => {
  await withEnv(
    { ECC_HOOKS_ECC_ROOT: ECC_ROOT, ECC_HOOK_PROFILE: "standard", ECC_DISABLED_HOOKS: "pre:bash:dispatcher" },
    async () => {
      const fake = makeFakePi();
      eccHooksExtension(fake.api as never);
      const toolCall = fake.events.get("tool_call")![0];
      const result = await toolCall(
        { toolName: "bash", toolCallId: "call-disabled", input: { command: 'git commit -m "x" --no-verify' } },
        { cwd: ROOT },
      );
      assert.equal(result, undefined);
    },
  );
});

test("rules extension lists stacks and injects selected rules", async () => {
  await withEnv(
    {
      ECC_PI_RULES: undefined,
      ECC_PI_RULES_ROOT: path.join(ROOT, "rules"),
      ECC_PI_RULES_MAX_CHARS: "100000",
    },
    async () => {
      const fake = makeFakePi();
      eccRulesExtension(fake.api as never);
      const command = fake.commands.find((c) => c.name === "ecc-rules");
      assert.ok(command);

      const messages: string[] = [];
      const ctx = { cwd: ROOT, ui: { notify: (m: string) => messages.push(m) } };
      const handler = command!.options.handler as (args: string, ctx: unknown) => Promise<void>;

      await handler("", ctx);
      assert.match(messages.at(-1) ?? "", /Off\./);

      await handler("typescript", ctx);
      assert.match(messages.at(-1) ?? "", /Active: common, typescript/);

      const beforeAgentStart = fake.events.get("before_agent_start")![0];
      const injected = (await beforeAgentStart({ systemPrompt: "BASE" }, ctx)) as { systemPrompt?: string } | undefined;
      assert.ok(injected?.systemPrompt?.startsWith("BASE"));
      assert.match(injected!.systemPrompt!, /<ecc-rules>/);
      assert.match(injected!.systemPrompt!, /typescript\/coding-style\.md/);

      await handler("bogus-stack", ctx);
      assert.match(messages.at(-1) ?? "", /Unknown stacks: bogus-stack/);

      await handler("off", ctx);
      const afterOff = (await beforeAgentStart({ systemPrompt: "BASE" }, ctx)) as { systemPrompt?: string } | undefined;
      assert.equal(afterOff, undefined);
    },
  );
});

test("agents extension registers run_agent and exposes generated agents", async () => {
  const fake = makeFakePi();
  eccAgentsExtension(fake.api as never);
  const tool = fake.tools.find((t) => t.name === "run_agent");
  assert.ok(tool, "run_agent tool not registered");
  assert.equal(typeof tool!.execute, "function");

  const generated = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "agents-generated.json"), "utf8"),
  ) as { agents: Array<{ name: string; systemPrompt: string; piTools: string[] }> };
  assert.ok(generated.agents.length >= 6);
  for (const agent of generated.agents) {
    assert.ok(agent.name);
    assert.ok(agent.systemPrompt.trim().length > 0, `agent ${agent.name} has no systemPrompt`);
    assert.ok(agent.piTools.length > 0, `agent ${agent.name} has no pi tools`);
  }

  const execute = tool!.execute as (
    id: string,
    params: Record<string, unknown>,
    signal: undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  const unknown = await execute("call-1", { agent: "does-not-exist", task: "x" }, undefined, undefined, { cwd: ROOT });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /Unknown agent/);
  assert.match(unknown.content[0].text, /planner/);
});
