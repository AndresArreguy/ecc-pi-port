/**
 * ECC hooks adapter for Pi.
 *
 * Runs original ECC hook scripts (unmodified, under ./ecc) by translating Pi
 * extension events into Claude-style hook payloads and executing
 * scripts/hooks/run-with-flags.js via child_process (no shell).
 *
 * Pure payload translation and gating live in ./lib/ecc-hooks-core.ts and are
 * covered by tests/pi-port/hooks-core.test.ts.
 *
 * Event names used are only those confirmed by installed Pi docs:
 * session_start, session_shutdown, session_before_compact, tool_call,
 * tool_result, agent_end.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildPostToolUsePayload,
  buildPreCompactPayload,
  buildPreToolUsePayload,
  buildSessionEndPayload,
  buildSessionStartPayload,
  buildStopPayload,
  extractAdditionalContext,
  extractBlockReason,
  HOOK_SPECS,
  isAdapterHookEnabled,
  mapPiToolNameToClaude,
  toolMatches,
  type EccEvent,
  type HookRunResult,
  type HookSpec,
  type PayloadContext,
  type SessionBeforeCompactEventLike,
  type SessionShutdownEventLike,
  type SessionStartEventLike,
  type ToolCallEventLike,
  type ToolResultEventLike,
} from "../lib/ecc-hooks-core.ts";
import { fileURLToPath } from "node:url";

interface PiUiContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface PiSessionManager {
  getSessionId?(): string;
  getSessionFile?(): string | undefined;
}

interface ExtensionContext {
  ui?: PiUiContext;
  cwd: string;
  sessionManager?: PiSessionManager;
  isIdle?(): boolean;
  hasUI?: boolean;
}

interface AgentEndEvent {
  messages?: unknown[];
}

interface BeforeAgentStartEvent {
  systemPrompt: string;
}

interface BeforeAgentStartResult {
  systemPrompt?: string;
}

interface ExtensionAPI {
  on(event: "session_start", handler: (event: SessionStartEventLike, ctx: ExtensionContext) => Promise<void> | void): void;
  on(event: "session_shutdown", handler: (event: SessionShutdownEventLike, ctx: ExtensionContext) => Promise<void> | void): void;
  on(event: "session_before_compact", handler: (event: SessionBeforeCompactEventLike, ctx: ExtensionContext) => Promise<void> | void): void;
  on(event: "tool_call", handler: (event: ToolCallEventLike, ctx: ExtensionContext) => Promise<{ block?: boolean; reason?: string; terminate?: boolean } | void> | { block?: boolean; reason?: string; terminate?: boolean } | void): void;
  on(event: "tool_result", handler: (event: ToolResultEventLike, ctx: ExtensionContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void): void;
  on(event: "agent_end", handler: (event: AgentEndEvent, ctx: ExtensionContext) => Promise<void> | void): void;
  on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void): void;
}

const HOOK_TIMEOUT_MS = 30_000;
const MAX_HOOK_OUTPUT_BYTES = 1024 * 1024;
const LOG_DIR = path.join(process.cwd(), ".pi-port", "logs");
const LOG_FILE = path.join(LOG_DIR, "ecc-hooks.log");

function logToFile(message: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Never throw from logging path.
  }
}

function resolveEccRoot(cwd: string): string {
  const fromEnv = process.env.ECC_HOOKS_ECC_ROOT || process.env.ECC_ROOT;
  if (fromEnv && fromEnv.trim()) return path.resolve(cwd, fromEnv.trim());
  // Extension lives at <package>/extensions/ecc-hooks.ts
  const fromHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ecc");
  if (fs.existsSync(fromHere)) return fromHere;
  return path.resolve(cwd, "ecc");
}

function payloadContext(ctx: ExtensionContext): PayloadContext {
  let sessionId: string | undefined;
  let sessionFile: string | undefined;
  try {
    sessionId = ctx.sessionManager?.getSessionId?.() || undefined;
  } catch {
    sessionId = undefined;
  }
  try {
    sessionFile = ctx.sessionManager?.getSessionFile?.() || undefined;
  } catch {
    sessionFile = undefined;
  }
  return { cwd: ctx.cwd, sessionId, sessionFile };
}

function runHook(
  eccRoot: string,
  cwd: string,
  spec: HookSpec,
  payload: unknown,
  envExtra: Record<string, string | undefined>,
): Promise<HookRunResult> {
  return new Promise((resolve) => {
    const runner = path.join(eccRoot, "scripts", "hooks", "run-with-flags.js");
    if (!fs.existsSync(runner)) {
      const result: HookRunResult = {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        error: `run-with-flags.js not found at ${runner}`,
      };
      logToFile(`ERROR ${spec.id}: ${result.error}`);
      resolve(result);
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envExtra,
      CLAUDE_PLUGIN_ROOT: eccRoot,
      ECC_PLUGIN_ROOT: eccRoot,
    };

    const child = execFile(
      process.execPath,
      [runner, spec.id, spec.script, spec.profiles],
      { cwd, env, timeout: HOOK_TIMEOUT_MS, maxBuffer: MAX_HOOK_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout : "";
        const err = typeof stderr === "string" ? stderr : "";
        if (error) {
          const timedOut = Boolean((error as { killed?: boolean }).killed) || /timed out/i.test(error.message || "");
          const rawCode = (error as { code?: unknown }).code;
          const code = typeof rawCode === "number" ? rawCode : 1;
          const result: HookRunResult = {
            stdout: out,
            stderr: err,
            exitCode: Number.isInteger(code) ? code : 1,
            timedOut,
            error: error.message,
          };
          logToFile(`WARN ${spec.id}: ${error.message} (exit=${result.exitCode}, timedOut=${timedOut})`);
          if (err.trim()) logToFile(`STDERR ${spec.id}: ${err.trim().slice(0, 2000)}`);
          resolve(result);
          return;
        }
        if (err.trim()) logToFile(`STDERR ${spec.id}: ${err.trim().slice(0, 2000)}`);
        resolve({ stdout: out, stderr: err, exitCode: 0, timedOut: false });
      },
    );

    child.stdin?.on("error", (e) => logToFile(`WARN ${spec.id}: stdin write error: ${e.message}`));
    try {
      child.stdin?.end(JSON.stringify(payload));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`WARN ${spec.id}: failed to write stdin: ${message}`);
    }
  });
}

export default function eccHooksExtension(pi: ExtensionAPI): void {
  let pendingSessionContext: string[] = [];
  let warnedMissingRoot = false;

  function getEccRoot(ctx: ExtensionContext): string | null {
    const root = resolveEccRoot(ctx.cwd);
    if (!fs.existsSync(root)) {
      if (!warnedMissingRoot) {
        warnedMissingRoot = true;
        logToFile(`ERROR: ECC root not found: ${root}`);
        try {
          ctx.ui?.notify?.(`[ecc-hooks] ECC root not found: ${root}`, "warning");
        } catch {
          // ignore notification failures
        }
      }
      return null;
    }
    return root;
  }

  async function runSpecsForEvent(
    ctx: ExtensionContext,
    eccEvent: EccEvent,
    claudeToolName: string | null,
    payload: unknown,
    envExtra: Record<string, string | undefined> = {},
  ): Promise<HookRunResult[]> {
    const eccRoot = getEccRoot(ctx);
    if (!eccRoot) return [];
    const payloadCtx = payloadContext(ctx);
    const results: HookRunResult[] = [];
    for (const spec of HOOK_SPECS) {
      if (spec.eccEvent !== eccEvent) continue;
      if (!isAdapterHookEnabled(spec, process.env)) continue;
      if (claudeToolName && !toolMatches(spec.matcher, claudeToolName)) continue;
      if (!claudeToolName && spec.matcher && spec.matcher !== "*" && spec.matcher !== ".*") continue;
      try {
        results.push(
          await runHook(eccRoot, ctx.cwd, spec, payload, {
            CLAUDE_PROJECT_DIR: ctx.cwd,
            CLAUDE_SESSION_ID: payloadCtx.sessionId,
            ...envExtra,
          }),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logToFile(`ERROR ${spec.id}: unhandled ${message}`);
      }
    }
    return results;
  }

  pi.on("before_agent_start", async (event) => {
    if (pendingSessionContext.length === 0) return;
    const block = pendingSessionContext.join("\n\n").trim();
    pendingSessionContext = [];
    if (!block) return;
    return { systemPrompt: `${event.systemPrompt}\n\n<ecc-session-context>\n${block}\n</ecc-session-context>` };
  });

  pi.on("session_start", async (event, ctx) => {
    try {
      const payload = buildSessionStartPayload(event, payloadContext(ctx));
      const results = await runSpecsForEvent(ctx, "SessionStart", null, payload);
      for (const r of results) {
        const extra = extractAdditionalContext(r.stdout);
        if (extra) pendingSessionContext.push(extra);
        if (r.error || r.timedOut || r.exitCode !== 0) {
          logToFile(`session_start hook result: exit=${r.exitCode} timedOut=${r.timedOut} err=${r.error || ""}`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR session_start handler: ${message}`);
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    try {
      await runSpecsForEvent(ctx, "SessionEnd", null, buildSessionEndPayload(event, payloadContext(ctx)));
      await runSpecsForEvent(ctx, "Stop", null, buildStopPayload(payloadContext(ctx)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR session_shutdown handler: ${message}`);
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    try {
      await runSpecsForEvent(ctx, "PreCompact", null, buildPreCompactPayload(event, payloadContext(ctx)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR session_before_compact handler: ${message}`);
    }
    // Never cancel compaction from the adapter by default.
  });

  pi.on("tool_call", async (event, ctx) => {
    try {
      const claudeTool = mapPiToolNameToClaude(event.toolName);
      const results = await runSpecsForEvent(ctx, "PreToolUse", claudeTool, buildPreToolUsePayload(event, payloadContext(ctx)));
      for (const r of results) {
        // Exit code 2 is the ECC/Claude blocking convention for PreToolUse hooks.
        if (r.exitCode === 2) {
          const reason = extractBlockReason(r.stdout, r.stderr) || "Blocked by ECC hook";
          logToFile(`BLOCK ${claudeTool} (${event.toolCallId}): ${reason}`);
          return { block: true, reason };
        }
        if (r.timedOut || r.error) {
          logToFile(`PreToolUse ${claudeTool} non-fatal: timedOut=${r.timedOut} err=${r.error || ""}`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR tool_call handler: ${message}`);
    }
    return;
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      const claudeTool = mapPiToolNameToClaude(event.toolName);
      const eccEvent: EccEvent = event.isError ? "PostToolUseFailure" : "PostToolUse";
      const results = await runSpecsForEvent(ctx, eccEvent, claudeTool, buildPostToolUsePayload(event, payloadContext(ctx)));
      for (const r of results) {
        const extra = extractAdditionalContext(r.stdout);
        if (extra) logToFile(`PostToolUse additionalContext (${claudeTool}): ${extra.slice(0, 500)}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR tool_result handler: ${message}`);
    }
    return;
  });

  pi.on("agent_end", async (_event, ctx) => {
    try {
      await runSpecsForEvent(ctx, "Stop", null, buildStopPayload(payloadContext(ctx)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logToFile(`ERROR agent_end handler: ${message}`);
    }
  });
}
