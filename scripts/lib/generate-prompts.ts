import fs from "node:fs";
import path from "node:path";
import { ensureDir, readJson } from "./fs-utils.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";

export type CommandStatus = "ready" | "partial" | "blocked";

export interface AllowlistCommand {
  source: string;
  name: string;
  sddRole: string;
  status: CommandStatus;
  blockedReason?: string;
  unblocksAt?: string;
  dependencies?: string[];
  adaptations?: string[];
  shimSkill?: string;
}

export interface AllowlistConfig {
  version: number;
  description?: string;
  commands: AllowlistCommand[];
  notes?: Record<string, string>;
}

export interface GeneratePromptsOptions {
  eccRoot: string;
  configRoot: string;
  outRoot: string;
  docsRoot: string;
}

export interface GeneratePromptsResult {
  commands: Array<{ name: string; status: CommandStatus }>;
}

export function adaptBody(body: string, sourceName: string): { body: string; autoAdaptations: string[] } {
  let out = body;
  const auto: string[] = [];

  const replacements: Array<[RegExp, string, string]> = [
    [/~\/\.claude\b/g, "~/.claude (Claude user config path; not used by this Pi port)", "Normalized ~/.claude user-config path references for Pi context."],
    [/\bClaude Code\b/g, "the coding agent", "Generalized Claude Code-specific wording."],
    [/\bTask tool\b/g, "`run_agent` tool", "Mapped Task tool delegation references to `run_agent`."],
    [/\bsubagent_type\b/g, "run_agent `agent`", "Mapped subagent_type references to the run_agent `agent` parameter."],
    [/\bgh pr create\b/g, "gh pr create (requires GitHub CLI/auth/network)", "Annotated gh-based PR actions as environment-dependent."],
  ];

  for (const [re, rep, note] of replacements) {
    if (re.test(out)) {
      out = out.replace(re, rep);
      auto.push(note);
    }
  }

  if (sourceName === "plan.md") {
    out = out.replace(
      /Run inline by default\. Do not call the (?:Task tool|`run_agent` tool) or any subagent by default\. This keeps `\/plan` usable from plugin installs that ship commands without agent files\./g,
      "Delegate the planning pass to the `planner` agent with `run_agent`. `planner` is read-only: it returns the plan and touches no files. Synthesize its output inline, resolve the open questions with the user, and only then start implementing.",
    );
    out = out.replace(
      /## Optional Planner Agent[\s\S]*?`agents\/planner\.md`\s*/g,
      [
        "## Planner Delegation",
        "",
        "Call `run_agent` with `agent: \"planner\"` and a brief that carries the goal, the files you already know about, and the constraints.",
        "",
        "- Unknown codebase area → run `code-explorer` first (read-only) and hand its findings to `planner`.",
        "- Plan hinges on a schema, contract or architecture call → use `architect` instead of `planner`.",
        "- One-line change or typo → do not delegate; edit inline.",
        "",
      ].join("\n"),
    );
  }

  if (sourceName === "feature-dev.md") {
    out = out.replace(
      /- use `code-explorer` to analyze the relevant existing code/g,
      "- delegate to `code-explorer` with `run_agent` (read-only) to trace execution paths, architecture and integration points; it returns analysis, not diffs",
    );
    out = out.replace(
      /- use `code-architect` to design the feature/g,
      "- delegate to `architect` with `run_agent` when the feature needs a schema, contract or architecture decision; skip it for straightforward changes",
    );
    out = out.replace(
      /- use `code-reviewer` to review the implementation/g,
      "- delegate to `code-reviewer` (plus the stack reviewer: `react-reviewer`, `typescript-reviewer`, …) once the implementation is green",
    );
    out = [
      "> **Pi port status:** el pipeline multi-agente corre con `run_agent` (subagentes aislados). El orquestador es el chat principal: delega, consolida y corre el gate del proyecto en `bash`. Agregá `security-reviewer` cuando el cambio toque auth, permisos, inputs de usuario o secretos.",
      "",
      "Implement the tasks with `tdd-guide` (tests first) and hand it one task per call, with the exact files and the done criterion. Serialize writes: two agents never touch the same file at once.",
      "",
      out.trimStart(),
    ].join("\n");
  }

  if (sourceName === "code-review.md") {
    out = out.replace(
      /### Phase 7 — PUBLISH[\s\S]*$/m,
      [
        "### Phase 7 — PUBLISH (conditional)",
        "",
        "If `gh` is available, authenticated, and network access is permitted, you may publish the review:",
        "",
        "```bash",
        "# Approve / request changes / comment (choose one)",
        'gh pr review <NUMBER> --approve --body "<summary>"',
        '# gh pr review <NUMBER> --request-changes --body "<summary>"',
        '# gh pr review <NUMBER> --comment --body "<summary>"',
        "```",
        "",
        "If `gh`/network access is unavailable, **do not fail the review**: keep the report local (e.g. `.claude/reviews/pr-<NUMBER>-review.md` or a workspace-local path) and summarize findings for manual posting.",
        "",
      ].join("\n"),
    );
    auto.push("Made PR publish/fetch steps conditional on gh auth and network availability; added local fallback.");
    out = [
      "> **Pi port status:** la revisión corre por `run_agent`: `code-reviewer`, o el reviewer del stack (`react-reviewer`, `typescript-reviewer`, `vue-reviewer`, …) cuando el diff es de un solo stack. Sumá `security-reviewer` si toca auth, permisos, inputs de usuario o secretos. El agente devuelve hallazgos; el gate del proyecto lo corrés vos.",
      "",
      out.trimStart(),
    ].join("\n");
  }

  if (sourceName === "test-coverage.md") {
    out = [
      "> **Pi port status:** usá `pr-test-analyzer` (read-only) para encontrar los gaps reales y después `tdd-guide` para escribir los tests que faltan. El analyzer devuelve prioridades, no código. Para un bug con repro, `tdd-guide` primero y el fix después.",
      "",
      out.trimStart(),
    ].join("\n");
  }

  if (sourceName === "prp-implement.md") {
    out = [
      "> **Pi port status:** ejecutá las tareas con `tdd-guide` (tests primero), una tarea por llamada y con las rutas exactas. Si el build o el typecheck se rompen, `build-error-resolver` en vez de pelear inline. La verificación final es tuya: corré el gate del proyecto y pegá la salida.",
      "",
      out.trimStart(),
    ].join("\n");
  }

  if (sourceName === "quality-gate.md") {
    out = [
      "> **Pi port status:** el adaptador de hooks (`extensions/ecc-hooks.ts`) ejecuta el quality gate de ECC en `tool_result` para `edit`/`write` cuando el hook está habilitado. Esta plantilla mantiene la alternativa inline como fallback.",
      "",
      "## Pi-adapted usage (inline formatter checks)",
      "",
      "The ECC `quality-gate` hook formats/checks one file by type. If the hook adapter is disabled, run the underlying formatter directly on the target file (`$ARGUMENTS` or chosen path):",
      "",
      "```bash",
      "# JS/TS/JSON/MD (project-dependent): prefer Biome or Prettier if configured",
      'npx --no-install biome check "<path>" || npx --no-install prettier --check "<path>"',
      "",
      "# Go",
      'gofmt -l "<path>"',
      "",
      "# Python",
      'ruff format --check "<path>"',
      "```",
      "",
      "To apply fixes (equivalent intent to `ECC_QUALITY_GATE_FIX=true`), use formatter write modes supported by the project (e.g. `prettier --write`, `ruff format <path>`, `gofmt -w <path>`). Lint/type/test verification is out of scope for this gate; use `test-coverage`, `code-review`, or the `verification-loop` skill as appropriate.",
      "",
      "If the gate keeps failing on something bigger than formatting (type errors, broken build, failing suite), delegate to `build-error-resolver` with `run_agent` and the failing command output in the brief.",
      "",
      "---",
      "",
      "## Original ECC command (reference, hook-dependent)",
      "",
      out.trimStart(),
    ].join("\n");
    auto.push("Documented the hook adapter path and kept inline formatter-check fallback.");
  }

  if (sourceName === "prp-implement.md" || sourceName === "plan-prd.md" || sourceName === "test-coverage.md") {
    auto.push("Retained .claude/* artifact paths for ECC workflow compatibility (portable-path strategy tracked as an open question).");
  }

  return { body: out, autoAdaptations: auto };
}

function buildAdaptationHeader(cmd: AllowlistCommand, extra: string[], shimSkill?: string): string {
  const lines: string[] = [];
  lines.push("Pi prompt template generated from ECC command");
  lines.push(`Source: ecc/commands/${cmd.source}`);
  lines.push(`SDD role: ${cmd.sddRole}`);
  lines.push(`Status: ${cmd.status}`);
  if (cmd.blockedReason) lines.push(`Blocked reason: ${cmd.blockedReason}`);
  if (cmd.unblocksAt) lines.push(`Unblocks at: ${cmd.unblocksAt}`);
  if (cmd.dependencies && cmd.dependencies.length) lines.push(`Dependencies: ${cmd.dependencies.join(", ")}`);
  if (shimSkill) lines.push(`Shim skill: ${shimSkill}`);
  const adaptations = [...(cmd.adaptations || []), ...extra];
  const seen = new Set<string>();
  const uniq = adaptations.filter((a) => {
    const k = a.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  lines.push("Adaptations:");
  if (uniq.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const a of uniq) lines.push(`- ${a}`);
  }
  return `<!--\n${lines.join("\n")}\n-->\n\n`;
}

function buildShimBody(cmd: AllowlistCommand, shimSkill: string): string {
  return [
    `This command is a Pi-port shim for ECC \`${cmd.source}\`.`,
    "",
    `Invoke and follow the **\`${shimSkill}\`** skill for this workflow.`,
    "",
    "Steps:",
    `1. Load the skill instructions for \`${shimSkill}\` (use \`/skill:${shimSkill}\` if available in your Pi session, or read its \`SKILL.md\` from the installed skills location).`,
    "2. Apply the skill to the user request and arguments: $ARGUMENTS",
    "3. If the skill is unavailable, report what is missing and proceed with the closest inline workflow.",
    "",
    cmd.status === "blocked" && cmd.blockedReason ? `> Blocked: ${cmd.blockedReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function statusBadge(status: CommandStatus): string {
  return status;
}

function generateDoc(config: AllowlistConfig): string {
  const lines: string[] = [];
  lines.push("# Pi Port — Commands (02)");
  lines.push("");
  lines.push("Generated by `npm run build` (or `node --experimental-strip-types scripts/build-prompts.ts`). Do not edit by hand.");
  lines.push("");
  lines.push("## Converted subset (SDD/quality focus)");
  lines.push("");
  lines.push("| Command | Source | SDD role | Status | Dependencies | Unblocks at | Notes |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const cmd of config.commands) {
    const deps = (cmd.dependencies || []).join(", ") || "-";
    const unblock = cmd.unblocksAt || "-";
    const note = cmd.blockedReason || (cmd.status === "partial" ? "Partially usable (see template header)." : "Converted prompt template.");
    lines.push(
      `| \`/${cmd.name}\` | \`ecc/commands/${cmd.source}\` | ${cmd.sddRole} | ${statusBadge(cmd.status)} | ${deps} | ${unblock.replace(/\|/g, "\\|")} | ${note.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Blocked or partially blocked commands (with unlock stage)");
  lines.push("");
  const blocked = config.commands.filter((c) => c.status === "blocked" || c.status === "partial" || c.blockedReason);
  if (blocked.length === 0) {
    lines.push("None in this subset.");
  } else {
    for (const cmd of blocked) {
      lines.push(`### \`/${cmd.name}\` (${cmd.status})`);
      lines.push("");
      lines.push(`- **Source:** \`ecc/commands/${cmd.source}\``);
      if (cmd.dependencies?.length) lines.push(`- **Dependencies:** ${cmd.dependencies.join(", ")}`);
      if (cmd.blockedReason) lines.push(`- **Blocked/limited because:** ${cmd.blockedReason}`);
      if (cmd.unblocksAt) lines.push(`- **Unblocks at:** ${cmd.unblocksAt}`);
      lines.push(`- **Generated template:** \`prompts/${cmd.name}.md\``);
      lines.push("");
    }
  }
  lines.push("## SDD mapping and notes");
  lines.push("");
  lines.push("- **Spec:** `/plan-prd` (lean PRD/spec artifact).");
  lines.push("- **Plan:** `/plan` (implementation plan; waits for confirmation).");
  lines.push("- **Implement:** `/prp-implement` (plan execution with validation loops), `/feature-dev` (run_agent pipeline: explorer → architect → tdd-guide → review).");
  lines.push("- **Review:** `/code-review` (local ready, PR publish/fetch partial depending on gh/network).");
  lines.push("- **Verify:** `/test-coverage` (coverage analysis and gap-filling workflow).");
  lines.push("- **Quality gate:** `/quality-gate` (hook adapter path plus inline formatter fallback).");
  lines.push("");
  if (config.notes) {
    for (const [k, v] of Object.entries(config.notes)) lines.push(`- **${k}:** ${v}`);
    lines.push("");
  }
  lines.push("## Regeneration");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function generatePrompts(options: GeneratePromptsOptions): GeneratePromptsResult {
  const eccRoot = path.resolve(options.eccRoot);
  const configRoot = path.resolve(options.configRoot);
  const promptsDir = path.join(path.resolve(options.outRoot), "prompts");
  const docPath = path.join(path.resolve(options.docsRoot), "02-commands.md");
  const allowlistPath = path.join(configRoot, "commands-allowlist.json");

  if (!fs.existsSync(eccRoot)) throw new Error(`ECC source not found at ${eccRoot}`);
  const config = readJson<AllowlistConfig>(allowlistPath);
  ensureDir(promptsDir);
  ensureDir(path.dirname(docPath));

  const seen = new Set<string>();
  const out: Array<{ name: string; status: CommandStatus }> = [];
  for (const cmd of config.commands) {
    if (seen.has(cmd.name)) throw new Error(`Duplicate command name in allowlist: ${cmd.name}`);
    seen.add(cmd.name);

    const sourcePath = path.join(eccRoot, "commands", cmd.source);
    if (!fs.existsSync(sourcePath)) throw new Error(`Source command missing: ${sourcePath}`);
    const source = fs.readFileSync(sourcePath, "utf8");
    const fm = parseFrontmatter(source);

    let shimSkill = cmd.shimSkill;
    if (!shimSkill) {
      const m = source.match(/\b(?:use|invoke|follow)\s+(?:the\s+)?`?([a-z0-9-]+)`?\s+skill\b/i);
      if (m && source.length < 1200) shimSkill = m[1];
    }

    const fmData: Record<string, string> = { ...fm.data };
    const frontmatterOut = serializeFrontmatter(fmData);

    let finalBody: string;
    let autoAdaptations: string[] = [];
    if (shimSkill) {
      finalBody = buildShimBody(cmd, shimSkill);
      autoAdaptations.push(`Rendered as a skill-invocation shim to \`${shimSkill}\` instead of duplicating command content.`);
    } else {
      const adapted = adaptBody(fm.body.trimEnd(), cmd.source);
      finalBody = adapted.body;
      autoAdaptations = adapted.autoAdaptations;
    }

    const header = buildAdaptationHeader(cmd, autoAdaptations, shimSkill);
    fs.writeFileSync(path.join(promptsDir, `${cmd.name}.md`), `${frontmatterOut}${header}${finalBody.trim()}\n`, "utf8");
    out.push({ name: cmd.name, status: cmd.status });
  }

  fs.writeFileSync(docPath, generateDoc(config), "utf8");
  return { commands: out };
}
