/**
 * ECC rules adapter for Pi.
 *
 * Pi has no native "rules" resource, so this extension injects ECC's per-stack
 * coding rules (generated into ./rules from ecc/rules) into the system prompt.
 *
 * Off by default. Enable with:
 *   ECC_PI_RULES=auto|off|<stack>[,<stack>...]
 * or at runtime:
 *   /ecc-rules            list stacks and current selection
 *   /ecc-rules auto       detect stack from project markers
 *   /ecc-rules typescript python
 *   /ecc-rules off
 *
 * ECC_PI_RULES_MAX_CHARS caps injected content (default 60000).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_MAX_CHARS,
  listRuleStacks,
  loadRules,
  resolveActiveStacks,
  type LoadedRules,
} from "../lib/ecc-rules-core.ts";
import { fileURLToPath } from "node:url";

interface PiUiContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface ExtensionContext {
  cwd: string;
  ui?: PiUiContext;
}

interface BeforeAgentStartEvent {
  systemPrompt: string;
}

interface BeforeAgentStartResult {
  systemPrompt?: string;
}

interface RegisterCommandOptions {
  description: string;
  getArgumentCompletions?(prefix: string): Array<{ value: string; label: string }> | null;
  handler(args: string, ctx: ExtensionContext): Promise<void> | void;
}

interface ExtensionAPI {
  registerCommand(name: string, options: RegisterCommandOptions): void;
  on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void): void;
}

function resolveRulesRoot(cwd: string): string {
  const fromEnv = process.env.ECC_PI_RULES_ROOT;
  if (fromEnv && fromEnv.trim()) return path.resolve(cwd, fromEnv.trim());
  const fromHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "rules");
  if (fs.existsSync(fromHere)) return fromHere;
  return path.resolve(cwd, "rules");
}

function maxChars(): number {
  const raw = Number(process.env.ECC_PI_RULES_MAX_CHARS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CHARS;
}

export default function eccRulesExtension(pi: ExtensionAPI): void {
  const rulesRoot = resolveRulesRoot(process.cwd());
  const available = listRuleStacks(rulesRoot);
  const envSelection = (process.env.ECC_PI_RULES || "").trim();
  let active: string[] = [];
  let invalid: string[] = [];
  if (envSelection) {
    const resolved = resolveActiveStacks(envSelection, process.cwd(), rulesRoot);
    active = resolved.stacks;
    invalid = resolved.invalid;
  }

  let cacheKey = "";
  let cache: LoadedRules | null = null;

  function getLoaded(): LoadedRules | null {
    if (active.length === 0) return null;
    const key = `${active.join(",")}|${maxChars()}`;
    if (cache && cacheKey === key) return cache;
    cache = loadRules(rulesRoot, active, maxChars());
    cacheKey = key;
    return cache;
  }

  pi.registerCommand("ecc-rules", {
    description: "List/inject ECC coding rules (auto, off, or stack names)",
    getArgumentCompletions: (prefix: string) => {
      const values = ["auto", "off", ...available].filter((value) => value.startsWith(prefix.toLowerCase()));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const raw = String(args || "").trim();
      const notify = ctx.ui?.notify ?? ((message: string) => process.stdout.write(`${message}\n`));

      if (raw && raw.toLowerCase() !== "list") {
        const resolved = resolveActiveStacks(raw, ctx.cwd, rulesRoot);
        if (resolved.invalid.length > 0) {
          notify(`[ecc-rules] Unknown stacks: ${resolved.invalid.join(", ")}.`, "error");
          return;
        }
        active = resolved.stacks;
        invalid = [];
        cache = null;
        cacheKey = "";
        if (active.length === 0) {
          notify("[ecc-rules] Rules disabled.", "info");
          return;
        }
      }

      if (active.length === 0) {
        notify(`[ecc-rules] Off. Available stacks: ${available.join(", ")}`, "info");
        return;
      }

      const loaded = getLoaded();
      const files = loaded?.files.length ?? 0;
      const truncated = loaded?.truncated ? " (truncated)" : "";
      notify(
        `[ecc-rules] Active: ${active.join(", ")} — ${files} files${truncated}. Available: ${available.join(", ")}`,
        "info",
      );
    },
  });

  pi.on("before_agent_start", async (event) => {
    const loaded = getLoaded();
    if (!loaded?.text) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${loaded.text}` };
  });

  if (invalid.length > 0) {
    process.stderr.write(`[ecc-rules] Ignoring unknown stacks from ECC_PI_RULES: ${invalid.join(", ")}\n`);
  }
}
