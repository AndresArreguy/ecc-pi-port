/**
 * ECC agents adapter for Pi.
 *
 * Registers a `run_agent` tool that executes ECC agent definitions (generated
 * from ./ecc/agents via scripts/build-agents.ts) in isolated child `pi`
 * processes (JSON mode) so the main session receives only the final result.
 *
 * No native subagent support exists in Pi core (confirmed in official docs);
 * this implementation uses child `pi` processes (subprocess isolation) as the
 * simplest option vs SDK/RPC in-process orchestration.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const pathMod = path;
import * as readline from "node:readline";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";

interface PiUiContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface ExtensionContext {
  cwd: string;
  ui?: PiUiContext;
  hasUI?: boolean;
  signal?: AbortSignal;
}

interface ToolExecuteContext {
  cwd: string;
  signal?: AbortSignal;
}

interface RunAgentParams {
  agent: string;
  task: string;
  cwd?: string;
  context?: string;
}

interface GeneratedAgent {
  name: string;
  source: string;
  description: string;
  model: string;
  eccTools: string[];
  piTools: string[];
  unmappedTools: string[];
  systemPrompt: string;
}

interface GeneratedAgentsFile {
  agents: GeneratedAgent[];
}

interface AgentModelConfig {
  model?: string | null;
  provider?: string | null;
  thinking?: string | null;
  maxTurns?: number | null;
  timeoutMs?: number | null;
}

interface AgentsModelsFile {
  defaults?: {
    maxTurns?: number;
    timeoutMs?: number;
    maxParallel?: number;
  };
  agents?: Record<string, AgentModelConfig>;
}

interface RunResult {
  finalText: string;
  turns: number;
  timedOut: boolean;
  turnLimitReached: boolean;
  aborted: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: string;
  providerError?: string;
}

const DEFAULT_LIMITS = {
  maxTurns: 12,
  timeoutMs: 300_000,
  maxParallel: 2,
};

const GENERATED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "agents-generated.json");
const MODELS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "agents-models.json");

let activeRuns = 0;
const waitQueue: Array<() => void> = [];

function readJsonSafe<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function getGeneratedAgents(): Map<string, GeneratedAgent> {
  const data = readJsonSafe<GeneratedAgentsFile>(GENERATED_PATH);
  const map = new Map<string, GeneratedAgent>();
  for (const agent of data?.agents || []) {
    if (agent?.name) map.set(String(agent.name), agent);
  }
  return map;
}

function getModelsConfig(): AgentsModelsFile {
  return readJsonSafe<AgentsModelsFile>(MODELS_PATH) || {};
}

function clampPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function resolveLimits(agentName: string): { maxTurns: number; timeoutMs: number; maxParallel: number } {
  const cfg = getModelsConfig();
  const defaults = cfg.defaults || {};
  const perAgent = (cfg.agents && cfg.agents[agentName]) || {};
  return {
    maxTurns: clampPositiveInt(perAgent.maxTurns ?? defaults.maxTurns, DEFAULT_LIMITS.maxTurns),
    timeoutMs: clampPositiveInt(perAgent.timeoutMs ?? defaults.timeoutMs, DEFAULT_LIMITS.timeoutMs),
    maxParallel: clampPositiveInt(defaults.maxParallel, DEFAULT_LIMITS.maxParallel),
  };
}

/**
 * The provider and model Pi itself defaults to.
 *
 * Pi's user settings live in the agent directory (`~/.pi/agent/settings.json`),
 * optionally overridden by `PI_CODING_AGENT_DIR`. The child cannot be left to
 * resolve a provider on its own: `--no-extensions` removes non-builtin
 * providers (a provider installed as its own package), so the fallback would be
 * a builtin the session may have no credit for. The environment is the first
 * answer, but it is not always readable from here.
 */
function piSettingsDefaults(): { provider: string | null; model: string | null } {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
    const provider = typeof settings?.defaultProvider === "string" ? settings.defaultProvider.trim() : "";
    const model = typeof settings?.defaultModel === "string" ? settings.defaultModel.trim() : "";

    return { provider: provider || null, model: model || null };
  } catch {
    return { provider: null, model: null };
  }
}

/** The provider a child should run against: pinned, then the session's, then pi's default. */
function childProvider(agentName: string, agent: GeneratedAgent): string | null {
  const per = (getModelsConfig().agents && getModelsConfig().agents[agentName]) || {};
  const pinned = typeof per.provider === "string" && per.provider.trim() ? per.provider.trim() : "";

  return pinned || (process.env.PI_PROVIDER?.trim() ?? "") || piSettingsDefaults().provider;
}

function resolveModelArgs(agentName: string, agent: GeneratedAgent): string[] {
  const cfg = getModelsConfig();
  const per = (cfg.agents && cfg.agents[agentName]) || {};
  const provider = typeof per.provider === "string" && per.provider.trim() ? per.provider.trim() : null;
  const model = typeof per.model === "string" && per.model.trim() ? per.model.trim() : null;
  const thinking = typeof per.thinking === "string" && per.thinking.trim() ? per.thinking.trim() : null;

  const args: string[] = [];
  // Per-agent config takes precedence; if absent, do not force ECC's default tier string
  // (Pi model IDs differ across providers/installations). Users can pin via config.
  if (provider && model) {
    args.push("--provider", provider, "--model", model);
  } else if (model) {
    args.push("--model", model);
  }

  // No per-agent pin: inherit the provider and model this session is authenticated
  // with, so a child never resolves a default provider it has no credit or key for.
  if (!provider && !model) {
    const defaults = piSettingsDefaults();
    const envProvider = process.env.PI_PROVIDER?.trim() || defaults.provider;
    const envModel = process.env.PI_MODEL?.trim() || defaults.model;
    if (envProvider && envModel) {
      args.push("--provider", envProvider, "--model", envModel);
    } else if (envModel) {
      args.push("--model", envModel);
    }
  }
  if (thinking) {
    args.push("--thinking", thinking);
  }
  return args;
}

async function acquireSlot(maxParallel: number): Promise<void> {
  if (activeRuns < maxParallel) {
    activeRuns += 1;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeRuns += 1;
}

function releaseSlot(): void {
  activeRuns = Math.max(0, activeRuns - 1);
  const next = waitQueue.shift();
  if (next) next();
}

function extractTextFromMessage(message: any): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block) continue;
      if (typeof block === "string") parts.push(block);
      else if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
    return parts.join("\n").trim();
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

/**
 * What the child has to know about this runtime, which is not Claude Code.
 *
 * The agent prompts are written for Claude Code: they name tools `Read`,
 * `Grep`, `Glob` and assume its calling convention. Cheaper models take that
 * literally and print tool syntax as text, so the turn ends with nothing read
 * and nothing answered. The contract is stated for every agent, in the terms
 * of the tools this runtime actually gives the child.
 */
function buildRuntimeContract(piTools: string[]): string {
  const tools = piTools.length > 0 ? piTools.join(", ") : "none";

  return [
    "## Runtime contract",
    "",
    `This is the Pi runtime. The only tools you have are: ${tools}.`,
    "They are real function calls: invoke one by making a tool call, never by writing",
    "tool syntax, XML tags or JSON blocks inside your answer.",
    "Tool names are lowercase exactly as listed above; `Read`, `Grep` and `Glob` do not exist here.",
    "Do not narrate a call nor echo its arguments. Read what the task needs, then finish with the",
    "final result as plain text.",
  ].join("\n");
}

function buildPrompt(task: string, context?: string): string {
  const extra = context && context.trim() ? `\n\nAdditional context:\n${context.trim()}` : "";
  return `Task:\n${task.trim()}${extra}\n\nUse your tools by calling them, never by writing tool syntax in the answer. Return only your final result for the main session, as plain text.`;
}

function findPiCliScript(): string | null {
  const env = process.env.PI_CLI_PATH && process.env.PI_CLI_PATH.trim();
  if (env && fs.existsSync(env)) return env;

  const candidates: string[] = [];
  // If running inside pi, argv[1] is often the CLI entry.
  const argv1 = process.argv[1];
  if (argv1 && /pi/i.test(argv1) && /cli.(js|mjs|cjs|ts)$/.test(argv1) && fs.existsSync(argv1)) {
    candidates.push(argv1);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(pathMod.join(appData, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"));
    }
  }
  candidates.push(pathMod.join(pathMod.dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"));
  candidates.push(pathMod.join(pathMod.dirname(process.execPath), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"));

  for (const c of candidates) {
    try {
      const resolved = pathMod.resolve(c);
      if (fs.existsSync(resolved)) return resolved;
    } catch {}
  }
  return null;
}

/**
 * The extensions a child needs even though `--no-extensions` disables discovery.
 *
 * A provider may ship as its own package (`pi-<provider>-provider`), and Pi only
 * registers it when that extension loads: without it the child cannot resolve
 * `--provider <name>`. `ECC_PI_EXTENSIONS` overrides the guess.
 */
function resolveExtensionArgs(provider: string | null): string[] {
  const configured = (process.env.ECC_PI_EXTENSIONS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured.flatMap((entry) => ["-e", entry]);
  }

  if (!provider) return [];

  const base = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", `pi-${provider}-provider`);
  const manifest = path.join(base, "package.json");

  try {
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const entries: unknown = pkg?.pi?.extensions;
    const files = Array.isArray(entries) && entries.length > 0 ? entries : ["index.ts"];

    return (files as string[])
      .map((file) => path.join(base, file))
      .filter((file) => fs.existsSync(file))
      .flatMap((file) => ["-e", file]);
  } catch {
    return [];
  }
}

function resolvePiSpawnSpec(args: string[]): { cmd: string; cmdArgs: string[] } {
  const envBin = process.env.PI_BIN && process.env.PI_BIN.trim();
  if (envBin) {
    // If PI_BIN points to a JS file, run with node.
    if (/.(js|mjs|cjs)$/.test(envBin)) {
      return { cmd: process.execPath, cmdArgs: [envBin, ...args] };
    }
    // On Windows .cmd shims need cmd.exe; prefer direct CLI script instead.
    if (process.platform === "win32" && /.(cmd|bat)$/i.test(envBin)) {
      const cli = findPiCliScript();
      if (cli) return { cmd: process.execPath, cmdArgs: [cli, ...args] };
      return { cmd: process.env.ComSpec || "cmd.exe", cmdArgs: ["/d", "/s", "/c", envBin, ...args] };
    }
    return { cmd: envBin, cmdArgs: args };
  }

  const cli = findPiCliScript();
  if (cli) {
    return { cmd: process.execPath, cmdArgs: [cli, ...args] };
  }

  if (process.platform === "win32") {
    // Fallback: shell out via cmd.exe (less ideal but functional if cli not found).
    return { cmd: process.env.ComSpec || "cmd.exe", cmdArgs: ["/d", "/s", "/c", "pi", ...args] };
  }
  return { cmd: "pi", cmdArgs: args };
}

function spawnPi(args: string[], cwd: string): ReturnType<typeof spawn> {
  const spec = resolvePiSpawnSpec(args);
  return spawn(spec.cmd, spec.cmdArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });
}

async function runAgentProcess(
  agent: GeneratedAgent,
  task: string,
  cwd: string,
  context: string | undefined,
  limits: { maxTurns: number; timeoutMs: number },
  parentSignal?: AbortSignal
): Promise<RunResult> {
  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
  ];

  if (agent.piTools.length > 0) {
    args.push("--tools", agent.piTools.join(","));
  } else {
    args.push("--no-tools");
  }

  // Restrict to agent's system prompt (isolated role)
  args.push("--system-prompt", `${agent.systemPrompt}\n\n${buildRuntimeContract(agent.piTools)}`);

  // The provider this session authenticated with, and the extension that registers it.
  args.push(...resolveExtensionArgs(childProvider(agent.name, agent)));

  // Model overrides from config (if set)
  args.push(...resolveModelArgs(agent.name, agent));

  args.push(buildPrompt(task, context));

  return await new Promise<RunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnPi(args, cwd);
    } catch (e: any) {
      resolve({ finalText: "", turns: 0, timedOut: false, turnLimitReached: false, aborted: false, exitCode: null, signal: null, stderr: "", error: e?.message || String(e) });
      return;
    }

    let stderr = "";
    let turns = 0;
    let lastAssistantText = "";
    let providerError = "";
    let timedOut = false;
    let turnLimitReached = false;
    let aborted = false;
    let settled = false;
    let killRequested = false;

    const finish = (result: Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
      resolve({
        finalText: lastAssistantText,
        turns,
        timedOut,
        turnLimitReached,
        aborted,
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
        stderr,
        error: result.error,
        providerError: providerError || undefined,
      });
    };

    const requestKill = (reason: "timeout" | "turn_limit" | "abort") => {
      if (killRequested) return;
      killRequested = true;
      if (reason === "timeout") timedOut = true;
      if (reason === "turn_limit") turnLimitReached = true;
      if (reason === "abort") aborted = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref?.();
    };

    const timeoutHandle = setTimeout(() => requestKill("timeout"), limits.maxTurns ? limits.timeoutMs : limits.timeoutMs);
    (timeoutHandle as any).unref?.();

    const onAbort = () => requestKill("abort");
    if (parentSignal) {
      if (parentSignal.aborted) requestKill("abort");
      else parentSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr?.on("data", (chunk) => {
      const s = String(chunk || "");
      stderr += s;
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    const rl = readline.createInterface({ input: child.stdout as any, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: any;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (evt?.type === "turn_end") {
        turns += 1;
        if (evt.message?.role === "assistant") {
          const text = extractTextFromMessage(evt.message);
          if (text) lastAssistantText = text;
          if (evt.message?.stopReason === "error") {
            providerError = String(evt.message?.errorMessage || "the provider ended the turn with an error");
          }
        }
        if (limits.maxTurns > 0 && turns >= limits.maxTurns) {
          requestKill("turn_limit");
        }
      } else if (evt?.type === "message_end") {
        if (evt.message?.role === "assistant") {
          const text = extractTextFromMessage(evt.message);
          if (text) lastAssistantText = text;
        }
      } else if (evt?.type === "agent_end") {
        // Fallback: try to extract last assistant message
        const msgs = Array.isArray(evt.messages) ? evt.messages : [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i]?.role === "assistant") {
            const text = extractTextFromMessage(msgs[i]);
            if (text) { lastAssistantText = text; break; }
          }
        }
      }
    });

    child.on("error", (err: any) => {
      finish({ error: err?.message || String(err) });
    });

    child.on("close", (code, signal) => {
      finish({ exitCode: code, signal });
    });
  });
}

function formatRunResult(agentName: string, source: string, result: RunResult): string {
  const header: string[] = [`[run_agent:${agentName}]`, `source=${source}`, `turns=${result.turns}`];
  if (result.turnLimitReached) header.push("status=turn_limit_reached");
  else if (result.timedOut) header.push("status=timeout");
  else if (result.aborted) header.push("status=aborted");
  else if (result.providerError) header.push("status=provider_error");
  else if (result.error) header.push("status=spawn_error");
  else if (result.exitCode && result.exitCode !== 0) header.push(`status=exit_${result.exitCode}`);
  // A turn that ended without an answer is a failure, never a success.
  else if (!result.finalText.trim()) header.push("status=empty");
  else header.push("status=ok");

  const parts = [header.join(" ")];
  if (result.finalText && result.finalText.trim()) {
    parts.push("", result.finalText.trim());
  } else {
    parts.push("", "(no final assistant text captured)");
  }
  if (result.providerError) parts.push("", `Provider error: ${result.providerError}`);
  if (result.error) parts.push("", `Error: ${result.error}`);
  if (result.stderr && result.stderr.trim()) {
    const tail = result.stderr.trim().split(/\r?\n/).slice(-20).join("\n");
    parts.push("", "Stderr (tail):", tail);
  }
  return parts.join("\n");
}

export default function eccAgentsExtension(pi: any): void {
  pi.registerTool({
    name: "run_agent",
    label: "Run ECC Agent",
    description: "Run an ECC agent (planner, code-reviewer, security-reviewer, build-error-resolver, tdd-guide, architect) in an isolated child pi session and return only the final result.",
    promptSnippet: "Run a specialized ECC agent in an isolated child Pi session and return its final result",
    promptGuidelines: [
      "Use run_agent when a task should be delegated to a specialized ECC agent (planner, code-reviewer, security-reviewer, build-error-resolver, tdd-guide, architect).",
      "Use run_agent with a clear task and optional context; prefer it for isolated analysis/review/planning without polluting the main session context.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name from generated subset (e.g. planner, code-reviewer, security-reviewer, build-error-resolver, tdd-guide, architect)" }),
      task: Type.String({ description: "Task/instructions for the agent" }),
      cwd: Type.Optional(Type.String({ description: "Working directory for the child session (defaults to current session cwd)" })),
      context: Type.Optional(Type.String({ description: "Additional context to include with the task" })),
    }),
    async execute(_toolCallId: string, params: RunAgentParams, _signal: AbortSignal | undefined, _onUpdate: any, ctx: ExtensionContext) {
      const agents = getGeneratedAgents();
      const agent = agents.get(params.agent);
      if (!agent) {
        const available = [...agents.keys()].join(", ") || "(none; run scripts/build-agents.ts)";
        return {
          content: [{ type: "text", text: `Unknown agent '${params.agent}'. Available: ${available}` }],
          details: { ok: false, error: "unknown_agent" },
          isError: true,
        };
      }

      const limits = resolveLimits(agent.name);
      const cwd = params.cwd && params.cwd.trim() ? path.resolve(ctx.cwd, params.cwd.trim()) : ctx.cwd;

      await acquireSlot(limits.maxParallel);
      try {
        const result = await runAgentProcess(agent, params.task, cwd, params.context, { maxTurns: limits.maxTurns, timeoutMs: limits.timeoutMs }, ctx.signal);
        const text = formatRunResult(agent.name, agent.source, result);
        const isError = Boolean(result.error) && !result.finalText;
        return {
          content: [{ type: "text", text }],
          details: {
            ok: !isError,
            agent: agent.name,
            turns: result.turns,
            timedOut: result.timedOut,
            turnLimitReached: result.turnLimitReached,
            aborted: result.aborted,
            exitCode: result.exitCode,
            signal: result.signal,
            limits,
            modelConfig: (getModelsConfig().agents || {})[agent.name] || null,
          },
          isError,
        };
      } finally {
        releaseSlot();
      }
    },
  });
}
