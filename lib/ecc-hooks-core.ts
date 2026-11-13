/**
 * Pure translation/gating logic for the ECC hooks adapter.
 *
 * Kept separate from `extensions/ecc-hooks.ts` so it can be unit-tested without
 * Pi and without spawning hook processes. No imports from Pi here.
 */

export type EccEvent =
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop";

export interface HookSpec {
  id: string;
  eccEvent: EccEvent;
  script: string;
  profiles: string;
  matcher: string;
  enabledByDefault: boolean;
}

/**
 * Default adapter subset. Everything runs through ECC's own
 * `scripts/hooks/run-with-flags.js`, so ECC_HOOK_PROFILE / ECC_DISABLED_HOOKS
 * still apply on top of this list.
 */
export const HOOK_SPECS: HookSpec[] = [
  { id: "session:start", eccEvent: "SessionStart", script: "scripts/hooks/session-start.js", profiles: "minimal,standard,strict", matcher: ".*", enabledByDefault: true },
  { id: "session:end:marker", eccEvent: "SessionEnd", script: "scripts/hooks/session-end-marker.js", profiles: "minimal,standard,strict", matcher: ".*", enabledByDefault: true },
  { id: "pre:bash:dispatcher", eccEvent: "PreToolUse", script: "scripts/hooks/pre-bash-dispatcher.js", profiles: "minimal,standard,strict", matcher: "Bash", enabledByDefault: true },
  { id: "pre:compact", eccEvent: "PreCompact", script: "scripts/hooks/pre-compact.js", profiles: "standard,strict", matcher: ".*", enabledByDefault: false },
  { id: "post:quality-gate", eccEvent: "PostToolUse", script: "scripts/hooks/quality-gate.js", profiles: "standard,strict", matcher: "Edit|Write|MultiEdit", enabledByDefault: true },
  { id: "stop:format-typecheck", eccEvent: "Stop", script: "scripts/hooks/stop-format-typecheck.js", profiles: "standard,strict", matcher: ".*", enabledByDefault: true },
  { id: "stop:session-end", eccEvent: "Stop", script: "scripts/hooks/session-end.js", profiles: "minimal,standard,strict", matcher: ".*", enabledByDefault: false },
  { id: "pre:write:doc-file-warning", eccEvent: "PreToolUse", script: "scripts/hooks/doc-file-warning.js", profiles: "standard,strict", matcher: "Write", enabledByDefault: false },
  { id: "pre:config-protection", eccEvent: "PreToolUse", script: "scripts/hooks/config-protection.js", profiles: "standard,strict", matcher: "Write|Edit|MultiEdit", enabledByDefault: false },
];

export const TOOL_NAME_TO_CLAUDE: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  find: "Find",
  ls: "Ls",
};

export interface PayloadContext {
  cwd: string;
  sessionId?: string;
  sessionFile?: string;
}

export interface SessionStartEventLike {
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}

export interface SessionShutdownEventLike {
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string;
}

export interface SessionBeforeCompactEventLike {
  reason: "manual" | "threshold" | "overflow";
  willRetry?: boolean;
}

export interface ToolCallEventLike {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEventLike {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  content: unknown;
  details?: unknown;
  structuredContent?: unknown;
  isError: boolean;
  usage?: unknown;
}

export interface HookRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  error?: string;
}

export function mapPiToolNameToClaude(toolName: string): string {
  const key = String(toolName || "").trim();
  if (!key) return "";
  return TOOL_NAME_TO_CLAUDE[key.toLowerCase()] || key.charAt(0).toUpperCase() + key.slice(1);
}

export function toolMatches(matcher: string, claudeToolName: string): boolean {
  const m = String(matcher || "").trim();
  if (!m || m === "*" || m === ".*") return true;
  const tool = String(claudeToolName || "");

  if (m.startsWith("^") || m.endsWith("$") || m.includes("(") || m.includes("[") || m.includes("\\")) {
    try {
      return new RegExp(m).test(tool);
    } catch {
      // fall through to literal matching
    }
  }

  if (m.includes("|")) {
    return m
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((part) => part.toLowerCase() === tool.toLowerCase());
  }

  return m.toLowerCase() === tool.toLowerCase();
}

export function parseEnabledHookIds(raw: string | undefined): Set<string> | "all" | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (value.toLowerCase() === "all") return "all";
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
}

export function isAdapterHookEnabled(spec: HookSpec, env: Record<string, string | undefined> = {}): boolean {
  const override = parseEnabledHookIds(env.ECC_PI_ADAPTER_HOOKS);
  if (override === "all") return true;
  if (override && override.size > 0) return override.has(spec.id) || spec.enabledByDefault;
  return spec.enabledByDefault;
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (!c) return "";
        if (typeof c === "string") return c;
        const text = (c as { text?: unknown }).text;
        if (typeof text === "string") return text;
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function buildSessionStartPayload(event: SessionStartEventLike, ctx: PayloadContext): Record<string, unknown> {
  const source = event.reason === "resume" || event.reason === "fork" ? "resume" : "startup";
  return {
    hook_event_name: "SessionStart",
    source,
    reason: event.reason,
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    transcript_path: ctx.sessionFile,
  };
}

export function buildSessionEndPayload(event: SessionShutdownEventLike, ctx: PayloadContext): Record<string, unknown> {
  return {
    hook_event_name: "SessionEnd",
    reason: event.reason,
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    transcript_path: ctx.sessionFile,
  };
}

export function buildPreCompactPayload(event: SessionBeforeCompactEventLike, ctx: PayloadContext): Record<string, unknown> {
  return {
    hook_event_name: "PreCompact",
    reason: event.reason,
    will_retry: event.willRetry === true,
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    transcript_path: ctx.sessionFile || "",
  };
}

export function buildPreToolUsePayload(event: ToolCallEventLike, ctx: PayloadContext): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    tool_name: mapPiToolNameToClaude(event.toolName),
    tool_input: event.input || {},
    tool_use_id: event.toolCallId,
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
  };
}

export function buildPostToolUsePayload(event: ToolResultEventLike, ctx: PayloadContext): Record<string, unknown> {
  const toolName = mapPiToolNameToClaude(event.toolName);
  const output = {
    content: event.content,
    text: contentToText(event.content),
    details: event.details,
    structuredContent: event.structuredContent,
    isError: event.isError === true,
    usage: event.usage,
  };
  return {
    hook_event_name: event.isError ? "PostToolUseFailure" : "PostToolUse",
    tool_name: toolName,
    tool_input: event.input || {},
    tool_output: output,
    tool_response: output,
    tool_use_id: event.toolCallId,
    is_error: event.isError === true,
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
  };
}

export function buildStopPayload(ctx: PayloadContext): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    transcript_path: ctx.sessionFile,
  };
}

export function tryParseJson(text: string): unknown | null {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractAdditionalContext(stdout: string): string | undefined {
  const parsed = tryParseJson(stdout) as { hookSpecificOutput?: { additionalContext?: unknown } } | null;
  if (!parsed || typeof parsed !== "object") return undefined;
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  if (typeof ctx === "string" && ctx.trim()) return ctx;
  if (Array.isArray(ctx)) {
    const joined = ctx.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
    return joined || undefined;
  }
  return undefined;
}

export function extractBlockReason(stdout: string, stderr: string): string | undefined {
  const parsed = tryParseJson(stdout) as Record<string, unknown> | null;
  const specific = parsed?.hookSpecificOutput as Record<string, unknown> | undefined;
  const candidates = [specific?.message, specific?.reason, parsed?.reason, parsed?.message];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  const s = String(stderr || "").trim();
  if (s) {
    const line = s.split(/\r?\n/).find((l) => l.trim());
    if (line) return line.trim().slice(0, 500);
  }
  return undefined;
}
