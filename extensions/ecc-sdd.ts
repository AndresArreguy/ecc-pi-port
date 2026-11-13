import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { Container, Input, SelectList, Spacer, Text, fuzzyFilter, getKeybindings } from "@earendil-works/pi-tui";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

interface PiUiContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
}

interface ExtensionCommandContext {
  cwd: string;
  ui?: PiUiContext;
  hasUI?: boolean;
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

interface PhaseModelConfig {
  provider?: string | null;
  model?: string | null;
  thinking?: string | null;
  tier?: string;
  notes?: string;
}

interface SddModelsConfig {
  description?: string;
  phases: Record<string, PhaseModelConfig>;
  phaseAliases?: Record<string, string>;
}

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

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "sdd-models.json");
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

function loadSddConfig(): SddModelsConfig {
  const cfg = readJson<SddModelsConfig>(CONFIG_PATH, { phases: {} });
  if (!cfg.phases) cfg.phases = {};
  if (!cfg.phaseAliases) cfg.phaseAliases = {};
  return cfg;
}

function saveSddConfig(cfg: SddModelsConfig) {
  writeJson(CONFIG_PATH, cfg);
}

function resolvePhase(cfg: SddModelsConfig, input: string): Phase | null {
  const key = (input || "").trim().toLowerCase();
  if (!key) return null;
  if (cfg.phases[key]) return key as Phase;
  const alias = cfg.phaseAliases?.[key];
  if (alias && cfg.phases[alias]) return alias as Phase;
  return null;
}

function phaseList(cfg: SddModelsConfig): string[] {
  return Object.keys(cfg.phases);
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

function formatConfigSummary(cfg: SddModelsConfig): string {
  const lines: string[] = ["SDD model config (config/sdd-models.json):"];
  for (const phase of phaseList(cfg)) {
    const p = cfg.phases[phase] || {};
    const prov = p.provider ?? "null";
    const model = p.model ?? "null";
    const think = p.thinking ?? "null";
    lines.push(`- ${phase}: provider=${String(prov)} model=${String(model)} thinking=${String(think)} tier=${p.tier || ""}`);
  }
  if (cfg.phaseAliases && Object.keys(cfg.phaseAliases).length) {
    lines.push(`aliases: ${Object.entries(cfg.phaseAliases).map(([k, v]) => `${k}->${v}`).join(", ")}`);
  }
  return lines.join("\n");
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

async function pickModelForPhase(
  ctx: ExtensionCommandContext,
  phase: string,
  tier: string,
  current: PhaseModelConfig,
  available: Array<{ label: string; provider: string; model: string }>
): Promise<string | "__cancel__"> {
  const ui: any = ctx?.ui as any;
  if (!ui || typeof ui.custom !== "function") return "__cancel__";

  const baseItems = [
    { value: "__keep__", label: `Mantener actual (${current.provider ?? "null"}/${current.model ?? "null"})`, description: "No cambiar modelo" },
    { value: "__clear__", label: "Limpiar (sin override)", description: "Quitar provider/model/thinking" },
    ...available.map((m) => ({ value: m.label, label: m.label, description: "" })),
  ];

  try {
    const result = await ui.custom(
      (tui: any, theme: any, _kb: any, done: (v: any) => void) => {
        const container = new Container();
        container.addChild(new Text(theme.bold(theme.fg("accent", `Modelo para fase: ${phase}`)), 0, 0));
        container.addChild(
          new Text(
            theme.fg(
              "muted",
              `Tier: ${tier || "?"} · ${available.length} modelos · actual: ${current.provider ?? "null"}/${current.model ?? "null"}`
            ),
            0,
            0
          )
        );
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", "Buscar:"), 0, 0));

        const input = new Input();
        container.addChild(input);
        container.addChild(new Spacer(1));

        let filteredItems = baseItems;
        let selectList: any;

        const buildList = (opts: any[]) => {
          const list = new SelectList(opts, Math.min(Math.max(opts.length, 1), 14), getSelectListTheme());
          if (typeof list.setSelectedIndex === "function") list.setSelectedIndex(0);
          list.onSelect = (item: any) => done(item?.value ?? "__cancel__");
          list.onCancel = () => done("__cancel__");
          return list;
        };

        const applyFilter = (query: string) => {
          const q = String(query || "").trim();
          filteredItems = q
            ? fuzzyFilter(baseItems, q, (item: any) => `${item.label} ${item.description || ""} ${item.value}`)
            : baseItems;

          let opts = filteredItems;
          if (opts.length === 0) {
            opts = [
              {
                value: "__nomatch__",
                label: `(Sin coincidencias para "${q}")`,
                description: "Seguí tipeando para filtrar",
              },
            ];
          }

          const newList = buildList(opts);
          // children: [title, subtitle, spacer, searchLabel, input, spacer, selectList, spacer, hint]
          container.children[container.children.length - 3] = newList;
          selectList = newList;
          if (tui?.requestRender) tui.requestRender();
        };

        selectList = buildList(filteredItems);
        container.addChild(selectList);
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", "Tipeá para filtrar · ↑↓ navegar · Enter seleccionar · Esc volver"), 0, 0));

        input.onSubmit = () => {
          if (selectList && typeof selectList.handleInput === "function") selectList.handleInput("\r");
        };

        container.handleInput = (data: string) => {
          let isNav = false;
          try {
            const kb = typeof getKeybindings === "function" ? getKeybindings() : null;
            if (kb) {
              isNav =
                kb.matches(data, "tui.select.up") ||
                kb.matches(data, "tui.select.down") ||
                kb.matches(data, "tui.select.pageUp") ||
                kb.matches(data, "tui.select.pageDown") ||
                kb.matches(data, "tui.select.confirm") ||
                kb.matches(data, "tui.select.cancel");
            }
          } catch {
            isNav = false;
          }

          if (isNav) {
            selectList?.handleInput?.(data);
          } else {
            input.handleInput(data);
            const q = typeof input.getValue === "function" ? input.getValue() : "";
            applyFilter(q);
          }
          if (tui?.requestRender) tui.requestRender();
        };

        (container as any).focused = true;
        return container;
      },
      { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "75%" } }
    );

    if (result == null) return "__cancel__";
    return String(result);
  } catch {
    return "__cancel__";
  }
}

async function runSddModelInteractive(ctx: ExtensionCommandContext): Promise<boolean> {
  const ui: any = ctx?.ui as any;
  if (!ui || typeof ui.select !== "function") return false;
  const cfg = loadSddConfig();
  const available = getAvailableModelChoices(ctx);

  while (true) {
    const action = await ui.select("SDD Models — perfil persistente (config/sdd-models.json)", [
      "Configurar modelos por fase",
      "Ver configuración actual",
      "Guardar y salir",
      "Cancelar",
    ]);
    if (!action || action === "Cancelar") {
      notify(ctx, "SDD model: selector cerrado (configuración guardada en config/sdd-models.json).", "info");
      return true;
    }
    if (action === "Ver configuración actual") {
      notify(ctx, formatConfigSummary(loadSddConfig()), "info");
      continue;
    }
    if (action === "Guardar y salir") {
      saveSddConfig(cfg);
      notify(ctx, "SDD model: configuración guardada en config/sdd-models.json (persistente entre sesiones).", "info");
      return true;
    }

    const phases = phaseList(cfg);
    const phasePick = await ui.select("Seleccioná la fase a configurar", [...phases, "Volver"]);
    if (!phasePick || phasePick === "Volver") continue;
    const phase = phasePick;
    const current = cfg.phases[phase] || {};

    let modelChoice: string = "__cancel__";
    if (typeof ui.custom === "function") {
      modelChoice = await pickModelForPhase(ctx, phase, current.tier || "", current, available);
    } else {
      // fallback (no custom UI)
      const fallback = await ui.select(`Modelo para fase '${phase}'`, [
        `Mantener actual (${current.provider ?? "null"}/${current.model ?? "null"})`,
        "Limpiar (sin override)",
        ...available.map((m) => m.label).slice(0, 80),
        "Volver",
      ]);
      if (!fallback || fallback === "Volver") modelChoice = "__cancel__";
      else if (fallback.startsWith("Mantener actual")) modelChoice = "__keep__";
      else if (fallback === "Limpiar (sin override)") modelChoice = "__clear__";
      else modelChoice = fallback;
    }

    if (!modelChoice || modelChoice === "__cancel__" || modelChoice === "__nomatch__") continue;

    if (modelChoice === "__clear__") {
      cfg.phases[phase] = { ...current, provider: null, model: null, thinking: null };
      saveSddConfig(cfg);
      notify(ctx, `Fase '${phase}': modelo limpiado y guardado.`, "info");
      continue;
    }

    if (modelChoice !== "__keep__") {
      const parsed = parseModelLabel(modelChoice);
      if (!parsed) {
        notify(ctx, `Selección de modelo inválida: ${modelChoice}`, "warning");
        continue;
      }
      cfg.phases[phase] = { ...current, provider: parsed.provider, model: parsed.model };
      saveSddConfig(cfg);
    }

    const thinkPick = await ui.select(
      `Thinking para fase '${phase}' (actual: ${cfg.phases[phase]?.thinking ?? "null"})`,
      ["Mantener actual", "null", "off", "minimal", "low", "medium", "high", "xhigh", "max"]
    );
    if (!thinkPick) continue;
    if (thinkPick !== "Mantener actual") {
      cfg.phases[phase] = { ...(cfg.phases[phase] || {}), thinking: thinkPick === "null" ? null : thinkPick };
      saveSddConfig(cfg);
    }

    notify(
      ctx,
      `Fase '${phase}' guardada: ${cfg.phases[phase]?.provider ?? "null"}/${cfg.phases[phase]?.model ?? "null"} (thinking=${cfg.phases[phase]?.thinking ?? "null"})`,
      "info"
    );
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

  pi.registerCommand("sdd-model", {
    description: "Configure or show SDD phase model mapping (config/sdd-models.json) — interactive selector when UI is available",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cfg = loadSddConfig();
      const trimmed = (args || "").trim();
      if (!trimmed) {
        const handled = await runSddModelInteractive(ctx);
        if (handled) return;
        notify(ctx, formatConfigSummary(cfg), "info");
        return;
      }

      // Usage: /sdd-model <phase> clear | /sdd-model <phase> <provider> <model> [thinking]
      const parts = trimmed.split(/\s+/);
      const phase = resolvePhase(cfg, parts[0]);
      if (!phase) {
        notify(ctx, `Unknown phase '${parts[0]}'. Known phases: ${phaseList(cfg).join(", ")}`, "error");
        return;
      }
      if (parts.length === 2 && parts[1].toLowerCase() === "clear") {
        cfg.phases[phase] = { ...(cfg.phases[phase] || {}), provider: null, model: null, thinking: null };
        saveSddConfig(cfg);
        notify(ctx, `Cleared model config for phase '${phase}'.`, "info");
        return;
      }
      if (parts.length < 3) {
        notify(ctx, `Usage: /sdd-model <phase> <provider> <model> [thinking] | /sdd-model <phase> clear | /sdd-model`, "error");
        return;
      }
      const provider = parts[1];
      const model = parts[2];
      const thinking = parts[3] || null;
      cfg.phases[phase] = { ...(cfg.phases[phase] || {}), provider, model, thinking };
      saveSddConfig(cfg);
      notify(ctx, `Set ${phase}: provider=${provider} model=${model} thinking=${thinking ?? "null"}`, "info");
    },
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
