import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  Input,
  SelectList,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import {
  THINKING_VALUES,
  applyProfile,
  createDefaultConfig,
  deepClonePhases,
  deleteProfile,
  formatConfigSummary,
  listProfiles,
  normalizeConfig,
  phaseList,
  profileSummary,
  resolvePhase as resolvePhaseKey,
  saveProfile,
  validateProfileName,
  MAX_PROFILE_NAME_LENGTH,
  type PhaseModelConfig,
  type ProfileResult,
  type SddModelsConfig,
} from "../lib/ecc-sdd-config.ts";
import {
  createTranslator,
  isSddLanguage,
  languageLabel,
  resolveLanguage,
  type ResolvedLanguage,
  type SddLanguage,
  type Translator,
} from "../lib/ecc-sdd-i18n.ts";

const execFileAsync = promisify(execFile);

interface PiUiContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
  custom?(factory: any, options?: any): Promise<any>;
}

interface ExtensionCommandContext {
  cwd: string;
  ui?: PiUiContext;
  hasUI?: boolean;
  mode?: string;
  model?: any;
  modelRegistry?: any;
  sendUserMessage?(content: string, options?: any): Promise<void> | void;
  sessionManager?: any;
}

interface ExtensionContext {
  cwd: string;
  ui?: PiUiContext;
  hasUI?: boolean;
  model?: any;
  modelRegistry?: any;
}

type Phase = "spec" | "plan" | "implement" | "review" | "verify" | "light";

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  messages: number;
}

interface PhaseRunState {
  feature: string;
  phase: Phase;
  command: string;
  modelLabel: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed";
  note?: string;
  usage: UsageTotals;
}

const DEFAULT_CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "sdd-models.json");
const SPECS_ROOT = "specs";
const STATE_PATH = path.join(SPECS_ROOT, ".sdd-state.json");

let activeRun: PhaseRunState | null = null;
let currentFeature: string | null = null;

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: any) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function slugifyFeature(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "feature";
}

/** Allow tests and power users to point the SDD config somewhere else. */
function configPath(): string {
  const override = process.env.ECC_PI_SDD_CONFIG?.trim();
  return override ? path.resolve(override) : DEFAULT_CONFIG_PATH;
}

function loadSddConfig(): SddModelsConfig {
  return normalizeConfig(readJson<unknown>(configPath(), createDefaultConfig()));
}

function saveSddConfig(cfg: SddModelsConfig) {
  writeJson(configPath(), cfg);
}

function resolvePhase(cfg: SddModelsConfig, input: string): Phase | null {
  return resolvePhaseKey(cfg, input) as Phase | null;
}

function getFeatureDir(cwd: string, feature: string): string {
  return path.join(cwd, SPECS_ROOT, slugifyFeature(feature));
}

function artifactPath(cwd: string, feature: string, name: string): string {
  return path.join(getFeatureDir(cwd, feature), name);
}

function readArtifactIfExists(cwd: string, feature: string, name: string): string | null {
  const p = artifactPath(cwd, feature, name);
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {}
  return null;
}

function loadState(cwd: string): { currentFeature?: string | null } {
  return readJson(path.join(cwd, STATE_PATH), {});
}

function saveState(cwd: string, state: { currentFeature?: string | null }) {
  writeJson(path.join(cwd, STATE_PATH), state);
}

function emptyUsage(): UsageTotals {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    messages: 0,
  };
}

function addUsage(totals: UsageTotals, usage: any) {
  if (!usage) return;
  totals.messages += 1;
  totals.input += Number(usage.input || 0);
  totals.output += Number(usage.output || 0);
  totals.cacheRead += Number(usage.cacheRead || 0);
  totals.cacheWrite += Number(usage.cacheWrite || 0);
  totals.totalTokens += Number(usage.totalTokens || 0);
  const c = usage.cost || {};
  totals.cost.input += Number(c.input || 0);
  totals.cost.output += Number(c.output || 0);
  totals.cost.cacheRead += Number(c.cacheRead || 0);
  totals.cost.cacheWrite += Number(c.cacheWrite || 0);
  totals.cost.total += Number(c.total || 0);
}

function formatCost(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  if (n === 0) return "$0.0000";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function formatUsage(u: UsageTotals): string {
  return `tokens(in=${u.input}, out=${u.output}, cacheRead=${u.cacheRead}, cacheWrite=${u.cacheWrite}, total=${u.totalTokens}) cost(total=${formatCost(u.cost.total)}, in=${formatCost(u.cost.input)}, out=${formatCost(u.cost.output)}, cacheRead=${formatCost(u.cost.cacheRead)}, cacheWrite=${formatCost(u.cost.cacheWrite)}) messages=${u.messages}`;
}

function costsFilePath(cwd: string, feature: string): string {
  return artifactPath(cwd, feature, "costs.md");
}

function appendCostRecord(cwd: string, run: PhaseRunState) {
  const p = costsFilePath(cwd, run.feature);
  ensureDir(path.dirname(p));
  const header = `# SDD Costs — ${slugifyFeature(run.feature)}\n\n| Phase | Command | Status | Started | Ended | Model | Input | Output | CacheRead | CacheWrite | TotalTokens | CostTotal | Messages |\n|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  const row = `| ${run.phase} | ${run.command} | ${run.status} | ${run.startedAt} | ${run.endedAt || ""} | ${run.modelLabel.replace(/\|/g, "\\|")} | ${run.usage.input} | ${run.usage.output} | ${run.usage.cacheRead} | ${run.usage.cacheWrite} | ${run.usage.totalTokens} | ${formatCost(run.usage.cost.total)} | ${run.usage.messages} |`;
  let content = "";
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, "utf8");
    if (!content.includes("| Phase | Command | Status |")) {
      content = header + "\n" + content;
    }
  } else {
    content = header;
  }
  if (!content.endsWith("\n")) content += "\n";
  content += row + "\n";
  if (run.note) content += `\n> Note (${run.phase}): ${run.note}\n`;
  fs.writeFileSync(p, content, "utf8");
}

async function switchToPhaseModel(pi: any, ctx: ExtensionCommandContext, phase: Phase): Promise<{ ok: boolean; label: string; reason?: string }> {
  const cfg = loadSddConfig();
  const pcfg = cfg.phases[phase] || {};
  const provider = typeof pcfg.provider === "string" ? pcfg.provider.trim() : "";
  const modelId = typeof pcfg.model === "string" ? pcfg.model.trim() : "";
  const thinking = typeof pcfg.thinking === "string" ? pcfg.thinking.trim() : "";

  if (!provider || !modelId) {
    return { ok: true, label: "(unchanged: no provider/model configured)", reason: "not-configured" };
  }

  const registry = ctx.modelRegistry || (ctx as any).modelRegistry;
  if (!registry || typeof registry.find !== "function") {
    return { ok: false, label: `${provider}/${modelId}`, reason: "modelRegistry unavailable in command context" };
  }

  let model: any;
  try {
    model = registry.find(provider, modelId);
  } catch (e: any) {
    return { ok: false, label: `${provider}/${modelId}`, reason: e?.message || "model lookup failed" };
  }
  if (!model) {
    return { ok: false, label: `${provider}/${modelId}`, reason: "model not found in registry" };
  }

  const setOk = await pi.setModel(model);
  if (!setOk) {
    return { ok: false, label: `${provider}/${modelId}`, reason: "pi.setModel returned false (auth/config issue?)" };
  }
  if (thinking && typeof pi.setThinkingLevel === "function") {
    try { pi.setThinkingLevel(thinking); } catch {}
  }
  return { ok: true, label: `${provider}/${modelId}${thinking ? ` (thinking=${thinking})` : ""}` };
}

function notify(ctx: any, msg: string, type: "info" | "warning" | "error" = "info") {
  try { ctx?.ui?.notify?.(msg, type); } catch {}
}

function parseFeatureAndRest(args: string): { feature: string | null; rest: string } {
  const trimmed = (args || "").trim();
  if (!trimmed) return { feature: null, rest: "" };
  const m = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return { feature: null, rest: trimmed };
  return { feature: slugifyFeature(m[1]), rest: (m[2] || "").trim() };
}

async function getGitDiff(cwd: string): Promise<string> {
  const cmds: Array<[string, string[]]> = [
    ["git", ["diff", "--no-color", "--unified=3"]],
    ["git", ["diff", "--cached", "--no-color", "--unified=3"]],
  ];
  const parts: string[] = [];
  for (const [cmd, argv] of cmds) {
    try {
      const { stdout } = await execFileAsync(cmd, argv, { cwd, maxBuffer: 1024 * 1024, windowsHide: true });
      const s = String(stdout || "").trim();
      if (s) parts.push(`$ ${cmd} ${argv.join(" ")}\n${s}`);
    } catch {}
  }
  if (parts.length === 0) {
    try {
      const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd, maxBuffer: 512 * 1024, windowsHide: true });
      const s = String(stdout || "").trim();
      if (s) parts.push(`(no textual diff captured; git status --short)\n${s}`);
    } catch {}
  }
  return parts.join("\n\n").trim();
}

function phasePrompt(phase: Phase, feature: string, cwd: string, argsRest: string, diffText?: string): string {
  const baseDir = `specs/${slugifyFeature(feature)}`;
  const common = [
    `You are executing SDD phase: ${phase} for feature "${slugifyFeature(feature)}".`,
    `Working directory: ${cwd}`,
    `Feature artifacts directory: ${baseDir}/`,
    ``,
    `Context discipline (important):`,
    `- Read ONLY the artifact file(s) explicitly listed below for this phase. Do not rely on prior conversation turns for requirements or decisions.`,
    `- Base your work on those files and the current repository state as needed.`,
    `- Write/update the required artifact file(s) under ${baseDir}/ using available tools.`,
  ];

  if (phase === "spec") {
    return [
      ...common,
      ``,
      `Inputs to read now: (none required; use the request below).`,
      `Required output artifact: ${baseDir}/spec.md`,
      ``,
      `Request:`,
      argsRest || "(no request provided; infer a minimal spec from repository context and state assumptions clearly)",
      ``,
      `Produce a clear, testable specification in ${baseDir}/spec.md including: problem/goal, scope, functional requirements, non-functional/constraints, acceptance criteria, edge cases, and open questions/assumptions.`,
      `Execute the corresponding spec/planning approach (you may apply the plan/spec skill guidance as appropriate).`,
      `At the end, summarize what you wrote to ${baseDir}/spec.md.`,
    ].join("\n");
  }

  if (phase === "plan") {
    return [
      ...common,
      ``,
      `Inputs to read now (only these prior artifacts):`,
      `- ${baseDir}/spec.md`,
      `Required output artifacts: ${baseDir}/plan.md and ${baseDir}/tasks.md`,
      ``,
      `Create an implementation plan and a concrete task breakdown.`,
      `- ${baseDir}/plan.md: architecture/approach, components/files likely affected, data/flow, risks, and validation strategy.`,
      `- ${baseDir}/tasks.md: ordered checklist of small tasks (markdown checkboxes). Each task must be actionable and test-aware.`,
      `Do not implement product code in this phase except if strictly necessary to inspect; focus on planning artifacts.`,
      `At the end, summarize what you wrote to ${baseDir}/plan.md and ${baseDir}/tasks.md.`,
    ].join("\n");
  }

  if (phase === "implement") {
    return [
      ...common,
      ``,
      `Inputs to read now (only these prior artifacts):`,
      `- ${baseDir}/spec.md`,
      `- ${baseDir}/plan.md`,
      `- ${baseDir}/tasks.md`,
      `Required output/artifact updates: implement code changes in the repository AND update ${baseDir}/tasks.md`,
      ``,
      `Implementation rules:`,
      `- Work task by task following ${baseDir}/tasks.md order.`,
      `- For each task: write/update tests BEFORE implementation (red), implement minimal code to pass (green), then refactor if needed.`,
      `- Mark each completed task in ${baseDir}/tasks.md by changing "- [ ]" to "- [x]" (and add brief notes if useful).`,
      `- Keep changes aligned with spec/plan; do not invent dependencies or requirements.`,
      `- If blocked, record the blocker clearly in ${baseDir}/tasks.md and stop.`,
      ``,
      argsRest ? `Additional implementation focus: ${argsRest}` : `Proceed with the next incomplete tasks in ${baseDir}/tasks.md.`,
      `At the end, report which tasks were completed, tests run/results, and remaining tasks.`,
    ].join("\n");
  }

  if (phase === "review") {
    return [
      ...common,
      ``,
      `Inputs to read now (only these prior artifacts):`,
      `- ${baseDir}/spec.md`,
      `- ${baseDir}/plan.md`,
      `- ${baseDir}/tasks.md (if present)`,
      `Required output artifact: ${baseDir}/review.md`,
      ``,
      `Review task: contrast the current diff against spec.md and plan.md.`,
      `Check specifically: edge cases covered, constraints respected, no invented dependencies/requirements, correctness risks, missing tests, and regressions.`,
      ``,
      `Diff to review (captured for this phase):`,
      "```diff",
      diffText || "(no diff captured)",
      "```",
      ``,
      `Write ${baseDir}/review.md with: summary, findings (severity + file/area + evidence), spec/plan compliance, edge cases, dependency/assumption issues, and recommended fixes.`,
    ].join("\n");
  }

  if (phase === "verify") {
    return [
      ...common,
      ``,
      `Inputs to read now (only these prior artifacts):`,
      `- ${baseDir}/spec.md`,
      `- ${baseDir}/plan.md`,
      `- ${baseDir}/tasks.md (if present)`,
      `- ${baseDir}/review.md (if present)`,
      `Required output artifact: ${baseDir}/verify.md`,
      ``,
      `Verification task: run appropriate checks/tests/build/lint relevant to this feature and repository; verify acceptance criteria from spec.md and plan.md.`,
      `Report pass/fail status, commands executed, results, gaps, and whether the feature is ready.`,
      `Write results to ${baseDir}/verify.md.`,
      ``,
      argsRest ? `Additional verification focus: ${argsRest}` : `Perform a focused verification based on available project tooling.`,
    ].join("\n");
  }

  return [
    ...common,
    ``,
    `Light task phase.`,
    argsRest || "Perform the requested light task.",
  ].join("\n");
}

function getAvailableModelChoices(ctx: ExtensionCommandContext): Array<{ label: string; provider: string; model: string }> {
  const registry = ctx.modelRegistry;
  let models: any[] = [];
  try {
    if (registry && typeof registry.getAvailable === "function") {
      models = registry.getAvailable() || [];
    } else if (registry && typeof registry.getAll === "function") {
      models = registry.getAll() || [];
    } else if (Array.isArray((ctx as any).models)) {
      models = (ctx as any).models;
    }
  } catch {}

  const out: Array<{ label: string; provider: string; model: string }> = [];
  for (const m of models || []) {
    if (!m) continue;
    const provider = String(m.provider || m.providerId || m.source || "").trim();
    const id = String(m.id || m.modelId || m.model || m.name || "").trim();
    if (!provider || !id) continue;
    out.push({ label: `${provider}/${id}`, provider, model: id });
  }
  const seen = new Set<string>();
  const deduped = out.filter(x => { if (seen.has(x.label)) return false; seen.add(x.label); return true; });
  deduped.sort((a, b) => a.label.localeCompare(b.label));
  return deduped;
}

function parseModelLabel(label: string): { provider: string; model: string } | null {
  const idx = label.indexOf("/");
  if (idx <= 0) return null;
  return { provider: label.slice(0, idx), model: label.slice(idx + 1) };
}

type ModelChoice = { label: string; provider: string; model: string };

type MenuAction = "edit" | "load" | "save" | "view" | "delete" | "language" | "exit";

interface PhaseEditorState {
  mode: "table" | "model" | "thinking" | "profileName" | "manualModel";
  row: number;
  col: 0 | 1;
  phases: Record<string, PhaseModelConfig>;
  profile: string | null;
  dirty: boolean;
  status: string;
  statusIsError: boolean;
  filter: string;
}

function padCell(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function phaseModelLabel(phase: PhaseModelConfig, t: Translator): string {
  const provider = typeof phase.provider === "string" ? phase.provider.trim() : "";
  const model = typeof phase.model === "string" ? phase.model.trim() : "";
  if (!provider && !model) return t("editor.overrideNone");
  if (provider && model) return `${provider}/${model}`;
  return model || provider;
}

function modelBaseItems(
  available: ModelChoice[],
  t: Translator,
): Array<{ value: string; label: string; description?: string }> {
  return [
    {
      value: "__clear__",
      label: t("editor.optionClear"),
      description: t("editor.optionClearDesc"),
    },
    {
      value: "__manual__",
      label: t("editor.optionManual"),
      description: t("editor.optionManualDesc"),
    },
    ...available.map((m) => ({ value: m.label, label: m.label })),
  ];
}

function buildModelSelectList(
  items: Array<{ value: string; label: string; description?: string }>,
  filter: string,
): SelectList {
  const query = filter.trim();
  const filtered = query ? fuzzyFilter(items, query, (item) => `${item.value} ${item.label}`) : items;
  const list = new SelectList(filtered, Math.min(Math.max(filtered.length, 1), 12), getSelectListTheme());
  list.setSelectedIndex(0);
  return list;
}

function translateProfileError(t: Translator, result: ProfileResult, name: string): string {
  switch (result.code) {
    case "name-empty":
      return t("validate.nameEmpty");
    case "name-too-long":
      return t("validate.nameTooLong", { max: MAX_PROFILE_NAME_LENGTH });
    case "name-invalid-chars":
      return t("validate.nameInvalidChars");
    case "name-reserved":
      return t("validate.nameReserved");
    case "profile-not-found":
      return t("profile.notFound", { name });
    default:
      return t("profile.saveFailed");
  }
}

/**
 * Single-screen editor: every SDD phase with its model and thinking level,
 * editable in place. Ctrl+S persists the live config, Ctrl+P saves a named
 * profile, and Esc closes without autosaving.
 */
async function editPhasesScreen(
  ctx: ExtensionCommandContext,
  available: ModelChoice[],
  lang: ResolvedLanguage,
): Promise<"saved" | "discarded" | "closed"> {
  const t = createTranslator(lang);
  const ui: any = ctx?.ui as any;
  if (!ui || typeof ui.custom !== "function" || (ctx.mode && ctx.mode !== "tui")) {
    notify(ctx, formatConfigSummary(loadSddConfig(), t), "info");
    return "closed";
  }

  const result = await ui.custom(
    (tui: any, theme: any, keybindings: any, done: (value: any) => void) => {
      const cfg = loadSddConfig();
      const state: PhaseEditorState = {
        mode: "table",
        row: 0,
        col: 0,
        phases: deepClonePhases(cfg.phases),
        profile: cfg.activeProfile || null,
        dirty: false,
        status: cfg.activeProfile
          ? t("editor.statusProfileActive", { name: cfg.activeProfile })
          : t("editor.statusNoProfile"),
        statusIsError: false,
        filter: "",
      };
      const rows = Object.keys(state.phases);
      const modelItems = modelBaseItems(available, t);
      let modelList: SelectList | null = null;
      let thinkingList: SelectList | null = null;
      const textInput = new Input({ placeholder: "" });
      let textPurpose: "profile" | "manual" | null = null;

      const setStatus = (text: string, isError = false) => {
        state.status = text;
        state.statusIsError = isError;
      };

      const markDirty = () => {
        state.dirty = true;
        state.profile = null;
      };

      const normalizeRow = () => {
        if (!rows.length) {
          state.row = 0;
          return;
        }
        if (state.row < 0) state.row = rows.length - 1;
        if (state.row >= rows.length) state.row = 0;
      };

      const currentPhase = () => rows[state.row];

      const buildThinkingList = (): SelectList => {
        const items = THINKING_VALUES.map((value) => ({
          value,
          label: value === "null" ? t("editor.thinkingNull") : value,
        }));
        const list = new SelectList(items, items.length, getSelectListTheme());
        const current = state.phases[currentPhase()]?.thinking ?? "null";
        const index = THINKING_VALUES.indexOf(current as (typeof THINKING_VALUES)[number]);
        if (index >= 0) list.setSelectedIndex(index);
        return list;
      };

      const rebuildModelList = () => {
        modelList = buildModelSelectList(modelItems, state.filter);
      };

      const persist = () => {
        const next = loadSddConfig();
        next.phases = deepClonePhases(state.phases);
        next.activeProfile = state.profile;
        saveSddConfig(next);
        state.dirty = false;
        state.status = state.profile
          ? t("editor.statusSavedProfileActive", { name: state.profile })
          : t("editor.statusSavedConfig");
        state.statusIsError = false;
      };

      const startProfileInput = () => {
        state.mode = "profileName";
        textPurpose = "profile";
        textInput.setValue(state.profile || "");
        textInput.focused = true;
        setStatus(t("editor.statusProfileNameHint"));
        tui.requestRender();
      };

      const startManualModel = () => {
        const phase = currentPhase();
        const current = state.phases[phase] || {};
        state.mode = "manualModel";
        textPurpose = "manual";
        textInput.setValue(current.provider && current.model ? `${current.provider}/${current.model}` : "");
        textInput.focused = true;
        setStatus(t("editor.statusManualHint"));
        tui.requestRender();
      };

      const commitText = () => {
        const value = textInput.getValue().trim();
        const phase = currentPhase();
        if (textPurpose === "profile") {
          const valid = validateProfileName(value);
          if (!valid.ok) {
            setStatus(translateProfileError(t, { ok: false, code: valid.code }, value), true);
            tui.requestRender();
            return;
          }
          const next = loadSddConfig();
          next.phases = deepClonePhases(state.phases);
          const saved = saveProfile(next, valid.name, state.phases);
          if (!saved.ok) {
            setStatus(translateProfileError(t, saved, valid.name), true);
            tui.requestRender();
            return;
          }
          saveSddConfig(next);
          state.profile = saved.key || valid.name;
          state.dirty = false;
          setStatus(t("profile.saved", { name: state.profile }));
        } else if (textPurpose === "manualModel") {
          const parsed = parseModelLabel(value);
          if (!parsed) {
            setStatus(t("editor.statusManualInvalid"), true);
            tui.requestRender();
            return;
          }
          state.phases[phase] = { ...(state.phases[phase] || {}), provider: parsed.provider, model: parsed.model };
          markDirty();
          setStatus(t("editor.statusModelSet", { phase, model: `${parsed.provider}/${parsed.model}` }));
        }
        state.mode = "table";
        textPurpose = null;
        textInput.focused = false;
      };

      const openModelPicker = () => {
        state.mode = "model";
        state.filter = "";
        textInput.setValue("");
        textInput.focused = true;
        rebuildModelList();
        setStatus(t("editor.pickerModelTitle", { phase: currentPhase() }));
        tui.requestRender();
      };

      const openThinkingPicker = () => {
        state.mode = "thinking";
        thinkingList = buildThinkingList();
        setStatus(t("editor.pickerThinkingTitle", { phase: currentPhase() }));
        tui.requestRender();
      };

      const applyModelChoice = (value: string) => {
        const phase = currentPhase();
        if (value === "__clear__") {
          state.phases[phase] = { ...(state.phases[phase] || {}), provider: null, model: null };
          markDirty();
          setStatus(t("editor.statusModelCleared", { phase }));
          state.mode = "table";
          textInput.focused = false;
        } else if (value === "__manual__") {
          startManualModel();
        } else {
          const parsed = parseModelLabel(value);
          if (!parsed) {
            setStatus(t("editor.statusManualInvalid"), true);
            return;
          }
          state.phases[phase] = { ...(state.phases[phase] || {}), provider: parsed.provider, model: parsed.model };
          markDirty();
          setStatus(t("editor.statusModelSet", { phase, model: `${parsed.provider}/${parsed.model}` }));
          state.mode = "table";
          textInput.focused = false;
        }
      };

      const applyThinkingChoice = (value: string) => {
        const phase = currentPhase();
        state.phases[phase] = { ...(state.phases[phase] || {}), thinking: value === "null" ? null : value };
        markDirty();
        setStatus(t("editor.statusThinkingSet", { phase, value }));
        state.mode = "table";
      };

      const renderTable = (width: number): string[] => {
        const lines: string[] = [];
        const profileLabel = state.profile
          ? t("editor.profile", { name: state.profile })
          : t("editor.profileCustom");
        lines.push(theme.bold(theme.fg("accent", t("editor.title"))));
        lines.push(theme.fg("muted", `${profileLabel}${state.dirty ? t("editor.unsaved") : ""}`));
        lines.push("");

        const phaseWidth = Math.max(9, Math.min(16, Math.max(...rows.map((row) => row.length), 4) + 3));
        const modelWidth = Math.max(16, Math.min(width - phaseWidth - 12, Math.max(22, Math.floor(width * 0.52))));
        const thinkingWidth = Math.max(8, width - phaseWidth - modelWidth);
        lines.push(
          theme.fg(
            "dim",
            truncateToWidth(
              padCell(t("editor.headerPhase"), phaseWidth) +
                padCell(t("editor.headerModel"), modelWidth) +
                padCell(t("editor.headerThinking"), thinkingWidth),
              width,
              "",
            ),
          ),
        );

        rows.forEach((phase, index) => {
          const phaseConfig = state.phases[phase] || {};
          const isRow = index === state.row;
          const phaseCell = padCell(`${isRow ? "› " : "  "}${phase}`, phaseWidth);
          const modelCell = padCell(phaseModelLabel(phaseConfig, t), modelWidth);
          const thinkingCell = padCell(phaseConfig.thinking ?? "null", thinkingWidth);
          const styledPhase = isRow ? theme.fg("accent", phaseCell) : phaseCell;
          const styledModel = isRow && state.col === 0 ? theme.bg("selectedBg", modelCell) : modelCell;
          const styledThinking = isRow && state.col === 1 ? theme.bg("selectedBg", thinkingCell) : theme.fg("muted", thinkingCell);
          lines.push(truncateToWidth(styledPhase + styledModel + styledThinking, width, ""));
        });

        if (!rows.length) lines.push(theme.fg("warning", t("editor.statusNoPhases")));
        lines.push("");
        lines.push(theme.fg("dim", truncateToWidth(t("editor.tableHints"), width, "")));
        if (state.status) {
          lines.push(theme.fg(state.statusIsError ? "error" : "muted", truncateToWidth(state.status, width, "")));
        }
        return lines;
      };

      const renderPicker = (width: number): string[] => {
        const isModel = state.mode === "model";
        const phase = currentPhase();
        const phaseConfig = state.phases[phase] || {};
        const lines: string[] = [];
        lines.push(
          theme.bold(
            theme.fg(
              "accent",
              isModel
                ? t("editor.pickerModelTitle", { phase })
                : t("editor.pickerThinkingTitle", { phase }),
            ),
          ),
        );
        lines.push(
          theme.fg(
            "muted",
            t("editor.current", {
              value: isModel ? phaseModelLabel(phaseConfig, t) : phaseConfig.thinking ?? "null",
            }),
          ),
        );
        lines.push("");
        if (isModel) {
          lines.push(theme.fg("dim", t("editor.search")));
          lines.push(...textInput.render(width));
          lines.push("");
        }
        const list = isModel ? modelList : thinkingList;
        if (list) lines.push(...list.render(width));
        lines.push("");
        lines.push(
          theme.fg(
            "dim",
            truncateToWidth(
              t(isModel ? "editor.modelPickerHints" : "editor.thinkingPickerHints"),
              width,
              "",
            ),
          ),
        );
        if (state.status) {
          lines.push(theme.fg(state.statusIsError ? "error" : "muted", truncateToWidth(state.status, width, "")));
        }
        return lines;
      };

      const renderTextMode = (width: number): string[] => {
        const isProfile = state.mode === "profileName";
        const lines: string[] = [
          theme.bold(
            theme.fg(
              "accent",
              isProfile
                ? t("editor.saveProfileTitle")
                : t("editor.manualModelTitle", { phase: currentPhase() }),
            ),
          ),
          theme.fg("muted", t(isProfile ? "editor.saveProfileDescription" : "editor.manualModelDescription")),
          "",
          theme.fg("dim", t(isProfile ? "editor.nameLabel" : "editor.manualLabel")),
          ...textInput.render(width),
          "",
          theme.fg(
            "dim",
            truncateToWidth(t(isProfile ? "editor.profileInputHints" : "editor.manualModelHints"), width, ""),
          ),
        ];
        if (state.status) {
          lines.push(theme.fg(state.statusIsError ? "error" : "muted", truncateToWidth(state.status, width, "")));
        }
        return lines;
      };

      return {
        focused: true,
        invalidate() {},
        render(width: number): string[] {
          if (state.mode === "table") return renderTable(width);
          if (state.mode === "model" || state.mode === "thinking") return renderPicker(width);
          return renderTextMode(width);
        },
        handleInput(data: string): void {
          const kbMatch = (id: string) => {
            try {
              return Boolean(keybindings && typeof keybindings.matches === "function" && keybindings.matches(data, id));
            } catch {
              return false;
            }
          };

          if (state.mode === "profileName" || state.mode === "manualModel") {
            if (matchesKey(data, "escape")) {
              state.mode = "table";
              textPurpose = null;
              textInput.focused = false;
              setStatus(t("common.cancelled"));
            } else if (matchesKey(data, "enter") || matchesKey(data, "ctrl+s")) {
              commitText();
            } else {
              textInput.handleInput(data);
            }
            tui.requestRender();
            return;
          }

          if (state.mode === "model") {
            if (matchesKey(data, "escape")) {
              state.mode = "table";
              textInput.focused = false;
              setStatus(t("editor.pickerModelTitle", { phase: currentPhase() }));
            } else if (matchesKey(data, "ctrl+s")) {
              persist();
            } else if (
              kbMatch("tui.select.up") ||
              kbMatch("tui.select.down") ||
              kbMatch("tui.select.pageUp") ||
              kbMatch("tui.select.pageDown")
            ) {
              modelList?.handleInput(data);
            } else if (matchesKey(data, "enter")) {
              const item = modelList?.getSelectedItem();
              if (item) applyModelChoice(item.value);
            } else {
              textInput.handleInput(data);
              const nextFilter = textInput.getValue();
              if (nextFilter !== state.filter) {
                state.filter = nextFilter;
                rebuildModelList();
              }
            }
            tui.requestRender();
            return;
          }

          if (state.mode === "thinking") {
            if (matchesKey(data, "escape")) {
              state.mode = "table";
              setStatus(t("editor.pickerThinkingTitle", { phase: currentPhase() }));
            } else if (matchesKey(data, "ctrl+s")) {
              persist();
            } else if (
              kbMatch("tui.select.up") ||
              kbMatch("tui.select.down") ||
              kbMatch("tui.select.pageUp") ||
              kbMatch("tui.select.pageDown")
            ) {
              thinkingList?.handleInput(data);
            } else if (matchesKey(data, "enter")) {
              const item = thinkingList?.getSelectedItem();
              if (item) applyThinkingChoice(item.value);
            }
            tui.requestRender();
            return;
          }

          if (matchesKey(data, "ctrl+s")) {
            persist();
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "ctrl+p")) {
            startProfileInput();
            return;
          }
          if (matchesKey(data, "escape")) {
            done(state.dirty ? "discarded" : "closed");
            return;
          }

          if (kbMatch("tui.select.up")) {
            state.row -= 1;
            normalizeRow();
          } else if (kbMatch("tui.select.down")) {
            state.row += 1;
            normalizeRow();
          } else if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) {
            state.col = 0;
          } else if (matchesKey(data, "right") || matchesKey(data, "tab")) {
            state.col = 1;
          } else if (matchesKey(data, "enter")) {
            if (!rows.length) {
              setStatus(t("editor.statusNoPhases"), true);
            } else if (state.col === 0) {
              openModelPicker();
            } else {
              openThinkingPicker();
            }
          }
          tui.requestRender();
        },
      };
    },
    { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "85%" } },
  );

  if (result === "discarded") {
    notify(ctx, t("editor.discarded"), "warning");
  }
  return result === "discarded" ? "discarded" : result === "saved" ? "saved" : "closed";
}

async function runSddModelInteractive(ctx: ExtensionCommandContext): Promise<boolean> {
  const ui: any = ctx?.ui as any;
  if (!ui || typeof ui.select !== "function") return false;
  const available = getAvailableModelChoices(ctx);

  while (true) {
    const cfg = loadSddConfig();
    const lang = resolveLanguage(cfg.language);
    const t = createTranslator(lang);
    const profiles = listProfiles(cfg);

    const actions: Array<{ id: MenuAction; label: string }> = [
      { id: "edit", label: t("menu.edit") },
      {
        id: "load",
        label: profiles.length ? t("menu.loadCount", { count: profiles.length }) : t("menu.load"),
      },
      { id: "save", label: t("menu.saveAs") },
      { id: "view", label: t("menu.view") },
      ...(profiles.length ? [{ id: "delete" as MenuAction, label: t("menu.delete") }] : []),
      { id: "language", label: t("menu.language") },
      { id: "exit", label: t("menu.exit") },
    ];

    const title = cfg.activeProfile
      ? t("menu.titleActive", { name: cfg.activeProfile })
      : t("menu.titleNoActive");
    const picked = await ui.select(title, actions.map((action) => action.label));
    if (!picked) {
      notify(ctx, t("menu.closed"), "info");
      return true;
    }
    const actionId = actions.find((action) => action.label === picked)?.id;

    if (actionId === "exit") {
      notify(ctx, t("menu.closed"), "info");
      return true;
    }

    if (actionId === "edit") {
      await editPhasesScreen(ctx, available, lang);
      continue;
    }

    if (actionId === "load") {
      if (!profiles.length) {
        notify(ctx, t("profile.noProfiles"), "warning");
        continue;
      }
      const labels = profiles.map((name) => `${name} — ${profileSummary(cfg, name, t)}`);
      const pick = await ui.select(t("profile.listTitle"), [...labels, t("common.back")]);
      if (!pick || pick === t("common.back")) continue;
      const index = labels.indexOf(pick);
      if (index < 0) continue;
      const applied = applyProfile(cfg, profiles[index]);
      if (!applied.ok) {
        notify(ctx, translateProfileError(t, applied, profiles[index]), "error");
        continue;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.loaded", { name: applied.key }), "info");
      continue;
    }

    if (actionId === "save") {
      const name = await ui.input?.(
        t("profile.namePrompt"),
        cfg.activeProfile || t("profile.namePlaceholder"),
      );
      if (name == null) continue;
      const saved = saveProfile(cfg, name, cfg.phases);
      if (!saved.ok) {
        notify(ctx, translateProfileError(t, saved, name), "error");
        continue;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.saved", { name: saved.key }), "info");
      continue;
    }

    if (actionId === "view") {
      notify(ctx, formatConfigSummary(cfg, t), "info");
      continue;
    }

    if (actionId === "delete") {
      const pick = await ui.select(t("profile.deleteTitle"), [...profiles, t("common.back")]);
      if (!pick || pick === t("common.back")) continue;
      const confirmed = await ui.confirm?.(
        t("profile.deleteConfirmTitle", { name: pick }),
        t("profile.deleteConfirmMessage"),
      );
      if (!confirmed) continue;
      const removed = deleteProfile(cfg, pick);
      if (!removed.ok) {
        notify(ctx, translateProfileError(t, removed, pick), "error");
        continue;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.deleted", { name: removed.key }), "info");
      continue;
    }

    if (actionId === "language") {
      const languageOptions: Array<{ value: SddLanguage; label: string }> = [
        { value: "auto", label: t("language.auto") },
        { value: "es", label: t("language.es") },
        { value: "en", label: t("language.en") },
      ];
      const pick = await ui.select(t("language.title"), [
        ...languageOptions.map((option) => option.label),
        t("common.back"),
      ]);
      if (!pick || pick === t("common.back")) continue;
      const value = languageOptions.find((option) => option.label === pick)?.value;
      if (!value) continue;
      cfg.language = value;
      saveSddConfig(cfg);
      const nextT = createTranslator(resolveLanguage(cfg.language));
      notify(ctx, nextT("language.changed", { value: languageLabel(nextT, value) }), "info");
      continue;
    }
  }
}

export default function eccSddExtension(pi: any): void {
  // Restore last feature hint from state if present
  try {
    // cwd not known at load; deferred until commands/events
  } catch {}

  pi.on("message_end", async (event: any, ctx: ExtensionContext) => {
    try {
      if (!activeRun) return;
      const msg = event?.message;
      if (!msg || msg.role !== "assistant") return;
      if (msg.usage) addUsage(activeRun.usage, msg.usage);
    } catch {}
  });

  const finalizeRun = (ctx: ExtensionContext, status: "completed" | "failed", note?: string) => {
    if (!activeRun) return;
    activeRun.status = status;
    activeRun.endedAt = new Date().toISOString();
    if (note) activeRun.note = note;
    try {
      appendCostRecord(ctx.cwd, activeRun);
      notify(ctx, `SDD ${activeRun.phase} ${status} (${slugifyFeature(activeRun.feature)}). ${formatUsage(activeRun.usage)}`, status === "completed" ? "info" : "warning");
    } catch (e: any) {
      notify(ctx, `SDD cost recording failed: ${e?.message || e}`, "warning");
    } finally {
      activeRun = null;
    }
  };

  pi.on("agent_end", async (_event: any, ctx: ExtensionContext) => {
    // Keep run open until settled in normal cases; but if settled never arrives, this is a fallback.
    if (activeRun && !activeRun.endedAt) {
      // no-op; prefer agent_settled for finalization
    }
  });

  pi.on("agent_settled", async (_event: any, ctx: ExtensionContext) => {
    if (!activeRun) return;
    finalizeRun(ctx, "completed");
  });

  async function startPhase(command: string, phase: Phase, args: string, ctx: ExtensionCommandContext) {
    if (!ctx?.cwd) {
      notify(ctx, "SDD: missing command context cwd", "error");
      return;
    }

    const state = loadState(ctx.cwd);
    if (state.currentFeature && !currentFeature) currentFeature = state.currentFeature;

    let feature = currentFeature;
    let rest = (args || "").trim();

    if (phase === "spec" || phase === "plan" || phase === "implement" || phase === "review" || phase === "verify") {
      const parsed = parseFeatureAndRest(args);
      if (parsed.feature) {
        feature = parsed.feature;
        rest = parsed.rest;
      }
    }
    if (!feature) {
      notify(ctx, `Usage: /${command} <feature> [details]. No current feature set.`, "error");
      return;
    }

    currentFeature = feature;
    saveState(ctx.cwd, { currentFeature: feature });
    ensureDir(getFeatureDir(ctx.cwd, feature));

    if (activeRun) {
      notify(ctx, `SDD: previous phase run (${activeRun.phase}/${activeRun.feature}) still tracked; finalizing as interrupted.`, "warning");
      finalizeRun(ctx, "failed", "interrupted by new phase command");
    }

    const switchResult = await switchToPhaseModel(pi, ctx, phase);
    if (!switchResult.ok) {
      notify(ctx, `SDD model switch failed for phase '${phase}': ${switchResult.reason} (${switchResult.label}). Aborting phase. Configure with /sdd-model.`, "error");
      return;
    }

    let diffText = "";
    if (phase === "review") {
      diffText = await getGitDiff(ctx.cwd);
    }

    const prompt = phasePrompt(phase, feature, ctx.cwd, rest, diffText);

    activeRun = {
      feature,
      phase,
      command: `/${command}`,
      modelLabel: switchResult.label,
      startedAt: new Date().toISOString(),
      status: "running",
      usage: emptyUsage(),
    };

    notify(ctx, `SDD ${phase} started for ${feature} using ${switchResult.label}. Artifact dir: specs/${feature}/`, "info");

    try {
      if (typeof ctx.sendUserMessage === "function") {
        await ctx.sendUserMessage(prompt);
      } else if (typeof pi.sendUserMessage === "function") {
        pi.sendUserMessage(prompt);
      } else {
        throw new Error("No sendUserMessage API available in command context");
      }
    } catch (e: any) {
      finalizeRun(ctx, "failed", `failed to dispatch phase prompt: ${e?.message || e}`);
      notify(ctx, `SDD failed to start agent turn: ${e?.message || e}`, "error");
    }
  }

  const sddModelHandler = async (args: string, ctx: ExtensionCommandContext) => {
    const cfg = loadSddConfig();
    const t = createTranslator(resolveLanguage(cfg.language));
    const trimmed = (args || "").trim();

    if (!trimmed) {
      const handled = await runSddModelInteractive(ctx);
      if (handled) return;
      notify(ctx, formatConfigSummary(cfg, t), "info");
      return;
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const rest = parts.slice(1).join(" ").trim();

    // Profile commands: /sdd-model save <name> | load <name> | delete <name> | profiles
    if (command === "profiles" || command === "list") {
      const names = listProfiles(cfg);
      if (!names.length) {
        notify(ctx, t("profile.noProfilesCli"), "info");
        return;
      }
      notify(
        ctx,
        [t("profile.listHeader"), ...names.map((name) => `- ${name}: ${profileSummary(cfg, name, t)}`)].join("\n"),
        "info",
      );
      return;
    }
    if (command === "save") {
      if (!rest) {
        notify(ctx, t("cli.usage"), "error");
        return;
      }
      const saved = saveProfile(cfg, rest, cfg.phases);
      if (!saved.ok) {
        notify(ctx, translateProfileError(t, saved, rest), "error");
        return;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.saved", { name: saved.key }), "info");
      return;
    }
    if (command === "load") {
      if (!rest) {
        notify(ctx, t("cli.usage"), "error");
        return;
      }
      const applied = applyProfile(cfg, rest);
      if (!applied.ok) {
        notify(ctx, translateProfileError(t, applied, rest), "error");
        return;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.loaded", { name: applied.key }), "info");
      return;
    }
    if (command === "delete" || command === "rm") {
      if (!rest) {
        notify(ctx, t("cli.usage"), "error");
        return;
      }
      const removed = deleteProfile(cfg, rest);
      if (!removed.ok) {
        notify(ctx, translateProfileError(t, removed, rest), "error");
        return;
      }
      saveSddConfig(cfg);
      notify(ctx, t("profile.deleted", { name: removed.key }), "info");
      return;
    }

    // Language commands: /sdd-model language [auto|es|en]
    if (command === "language" || command === "lang" || command === "idioma") {
      if (!rest) {
        notify(ctx, t("language.current", { value: languageLabel(t, cfg.language) }), "info");
        return;
      }
      const value = rest.toLowerCase();
      if (!isSddLanguage(value)) {
        notify(ctx, t("language.usage"), "error");
        return;
      }
      cfg.language = value;
      saveSddConfig(cfg);
      const nextT = createTranslator(resolveLanguage(cfg.language));
      notify(ctx, nextT("language.changed", { value: languageLabel(nextT, value) }), "info");
      return;
    }

    // Phase commands: /sdd-model <phase> clear | /sdd-model <phase> <provider> <model> [thinking]
    const phase = resolvePhase(cfg, parts[0]);
    if (!phase) {
      notify(ctx, t("cli.unknownPhase", { phase: parts[0], list: phaseList(cfg).join(", ") }), "error");
      return;
    }
    if (parts.length === 2 && parts[1].toLowerCase() === "clear") {
      cfg.phases[phase] = { ...(cfg.phases[phase] || {}), provider: null, model: null, thinking: null };
      cfg.activeProfile = null;
      saveSddConfig(cfg);
      notify(ctx, t("cli.cleared", { phase }), "info");
      return;
    }
    if (parts.length < 3) {
      notify(ctx, t("cli.usage"), "error");
      return;
    }
    const provider = parts[1];
    const model = parts[2];
    const thinking = parts[3] || null;
    cfg.phases[phase] = { ...(cfg.phases[phase] || {}), provider, model, thinking };
    cfg.activeProfile = null;
    saveSddConfig(cfg);
    notify(ctx, t("cli.set", { phase, provider, model, thinking: thinking ?? "null" }), "info");
  };

  pi.registerCommand("sdd-model", {
    description:
      "Edit SDD phase models on one screen, save/load named profiles (config/sdd-models.json) — interactive when UI is available",
    handler: sddModelHandler,
  });

  pi.registerCommand("sdd-models", {
    description: "Alias of /sdd-model: SDD phase models and named profiles",
    handler: sddModelHandler,
  });

  pi.registerCommand("sdd-spec", {
    description: "SDD spec phase: switch to spec model, generate specs/<feature>/spec.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => startPhase("sdd-spec", "spec", args, ctx),
  });

  pi.registerCommand("sdd-plan", {
    description: "SDD plan/architecture phase: read spec.md, generate plan.md and tasks.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => startPhase("sdd-plan", "plan", args, ctx),
  });

  pi.registerCommand("sdd-implement", {
    description: "SDD implementation phase: work task-by-task from tasks.md (tests first), mark tasks done",
    handler: async (args: string, ctx: ExtensionCommandContext) => startPhase("sdd-implement", "implement", args, ctx),
  });

  pi.registerCommand("sdd-review", {
    description: "SDD review phase: contrast diff against spec.md/plan.md, write review.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => startPhase("sdd-review", "review", args, ctx),
  });

  pi.registerCommand("sdd-verify", {
    description: "SDD verification phase: run checks against spec/plan/tasks/review, write verify.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => startPhase("sdd-verify", "verify", args, ctx),
  });
}
