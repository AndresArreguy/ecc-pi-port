import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostToolUsePayload,
  buildPreCompactPayload,
  buildPreToolUsePayload,
  buildSessionEndPayload,
  buildSessionStartPayload,
  buildStopPayload,
  contentToText,
  extractAdditionalContext,
  extractBlockReason,
  HOOK_SPECS,
  isAdapterHookEnabled,
  mapPiToolNameToClaude,
  parseEnabledHookIds,
  toolMatches,
} from "../../lib/ecc-hooks-core.ts";

test("maps Pi tool names to Claude/ECC matchers", () => {
  assert.equal(mapPiToolNameToClaude("bash"), "Bash");
  assert.equal(mapPiToolNameToClaude("edit"), "Edit");
  assert.equal(mapPiToolNameToClaude("unknown_tool"), "Unknown_tool");
  assert.equal(mapPiToolNameToClaude(""), "");
});

test("tool matcher supports wildcard, pipe list and regex", () => {
  assert.equal(toolMatches(".*", "Bash"), true);
  assert.equal(toolMatches("Edit|Write|MultiEdit", "Write"), true);
  assert.equal(toolMatches("Edit|Write|MultiEdit", "Read"), false);
  assert.equal(toolMatches("^mcp__", "mcp__github__search"), true);
  assert.equal(toolMatches("Bash", "bash"), true);
  assert.equal(toolMatches("Bash", "Read"), false);
});

test("session payloads translate Pi reasons", () => {
  const ctx = { cwd: "/repo", sessionId: "s1", sessionFile: "/tmp/session.jsonl" };
  const startup = buildSessionStartPayload({ reason: "startup" }, ctx);
  assert.equal(startup.hook_event_name, "SessionStart");
  assert.equal(startup.source, "startup");
  assert.equal(startup.session_id, "s1");
  assert.equal(startup.transcript_path, "/tmp/session.jsonl");

  const resume = buildSessionStartPayload({ reason: "resume" }, ctx);
  assert.equal(resume.source, "resume");
  const fork = buildSessionStartPayload({ reason: "fork" }, ctx);
  assert.equal(fork.source, "resume");

  const end = buildSessionEndPayload({ reason: "quit" }, ctx);
  assert.equal(end.hook_event_name, "SessionEnd");
  assert.equal(end.reason, "quit");

  const compact = buildPreCompactPayload({ reason: "threshold", willRetry: true }, ctx);
  assert.equal(compact.hook_event_name, "PreCompact");
  assert.equal(compact.will_retry, true);

  const stop = buildStopPayload(ctx);
  assert.equal(stop.hook_event_name, "Stop");
});

test("pre-tool payload carries Claude tool name and input", () => {
  const payload = buildPreToolUsePayload(
    { toolName: "bash", toolCallId: "call-1", input: { command: "git status" } },
    { cwd: "/repo", sessionId: "s1" },
  );
  assert.equal(payload.hook_event_name, "PreToolUse");
  assert.equal(payload.tool_name, "Bash");
  assert.deepEqual(payload.tool_input, { command: "git status" });
  assert.equal(payload.tool_use_id, "call-1");
});

test("post-tool payload maps success and failure events", () => {
  const ok = buildPostToolUsePayload(
    {
      toolName: "edit",
      toolCallId: "call-2",
      input: { path: "a.ts" },
      content: [{ type: "text", text: "done" }],
      isError: false,
    },
    { cwd: "/repo", sessionId: "s1" },
  );
  assert.equal(ok.hook_event_name, "PostToolUse");
  assert.equal(ok.tool_name, "Edit");
  assert.equal((ok.tool_output as { text: string }).text, "done");

  const failure = buildPostToolUsePayload(
    { toolName: "bash", toolCallId: "call-3", input: {}, content: "boom", isError: true },
    { cwd: "/repo" },
  );
  assert.equal(failure.hook_event_name, "PostToolUseFailure");
  assert.equal(failure.is_error, true);
});

test("contentToText normalizes strings, arrays and objects", () => {
  assert.equal(contentToText("plain"), "plain");
  assert.equal(contentToText([{ type: "text", text: "a" }, { text: "b" }, "c"]), "a\nb\nc");
  assert.equal(contentToText({ a: 1 }), '{"a":1}');
  assert.equal(contentToText(null), "");
});

test("adapter hook gating honors defaults and ECC_PI_ADAPTER_HOOKS", () => {
  assert.equal(parseEnabledHookIds(""), null);
  assert.equal(parseEnabledHookIds("all"), "all");
  assert.deepEqual([...(parseEnabledHookIds("a,b") as Set<string>)], ["a", "b"]);

  const qualityGate = HOOK_SPECS.find((s) => s.id === "post:quality-gate");
  const preCompact = HOOK_SPECS.find((s) => s.id === "pre:compact");
  assert.ok(qualityGate && preCompact);

  assert.equal(isAdapterHookEnabled(qualityGate, {}), true);
  assert.equal(isAdapterHookEnabled(preCompact, {}), false);
  assert.equal(isAdapterHookEnabled(preCompact, { ECC_PI_ADAPTER_HOOKS: "all" }), true);
  // explicit lists are additive: defaults stay on, listed hooks turn on
  assert.equal(isAdapterHookEnabled(preCompact, { ECC_PI_ADAPTER_HOOKS: "pre:compact" }), true);
  assert.equal(isAdapterHookEnabled(qualityGate, { ECC_PI_ADAPTER_HOOKS: "pre:compact" }), true);
});

test("extracts additionalContext and block reasons from hook output", () => {
  assert.equal(
    extractAdditionalContext('{"hookSpecificOutput":{"additionalContext":"hello"}}'),
    "hello",
  );
  assert.equal(
    extractAdditionalContext('{"hookSpecificOutput":{"additionalContext":["a","b"]}}'),
    "a\nb",
  );
  assert.equal(extractAdditionalContext("not json"), undefined);

  assert.equal(
    extractBlockReason('{"hookSpecificOutput":{"message":"no way"}}', ""),
    "no way",
  );
  assert.equal(extractBlockReason("", "BLOCKED: reason here\nmore"), "BLOCKED: reason here");
  assert.equal(extractBlockReason("", ""), undefined);
});
