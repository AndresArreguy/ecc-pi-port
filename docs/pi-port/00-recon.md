# Pi Port Recon (ECC `v2.2.3`)

Workspace: `C:\BaráDev\pi-ecc`  
Scope: analysis/documentation only inside this directory. `./ecc` was not modified.

## 1) `ecc/pi/core` (README, CURATION, manifest, build)

Sources read:
- `ecc/pi/core/README.md`
- `ecc/pi/core/CURATION.md`
- `ecc/manifests/pi-core.json`
- `ecc/scripts/build-pi-core.js`

### What `pi/core` is
`pi/core` is a **generated, committed Pi-native package profile** of ECC: portable engineering content only.

- Package identity: `ecc-pi-core` v`2.2.3` (`ecc/pi/core/package.json`)
- Manifest: `pi: { "skills": ["./skills"], "prompts": ["./commands"] }`
- Contents: `skills/` + `commands/` + `README.md` + `CURATION.md` + `LICENSE`
- No extensions, no hooks, no runtime downloads, no network/SaaS dependencies by design.

### What it includes
From `manifests/pi-core.json` / generated profile:

- **123 skills** (curated from 293 root skills). Focus: language/framework patterns, testing/TDD, code/security review (non-offensive), planning, refactoring, docs, git/PR workflows.
  - Notable rename in profile: `council` shipped as `ecc-council` inside `pi/core` (root skill name unchanged).
- **24 prompt commands** (curated from 94 root commands), all “pure prompt workflows”.
  - Included: `aside`, `build-fix`, `code-review`, `cpp-test`, `fastapi-review`, `feature-dev`, `flutter-test`, `go-test`, `gradle-build`, `kotlin-test`, `plan-prd`, `plan`, `pr`, `prp-commit`, `prp-implement`, `prp-plan`, `prp-prd`, `react-test`, `refactor-clean`, `rust-test`, `test-coverage`, `update-codemaps`, `update-docs`.

### What it excludes on purpose
Curation rules (`manifests/pi-core.json.curationRules`, enumerated in `CURATION.md`):

- Network calls / API keys / runtime downloads (`npx`, `pip install`, `curl|sh`, etc.)
- Third-party SaaS wrappers (exa, context7, fal, videodb, x-api, social/marketing/SEO/outreach)
- Commercial/product integrations (ECC Tools/ecc.tools, AgentShield, billing/ops)
- Claude-Code-only mechanics (hooks, agent rosters/orch-*, continuous-learning, loops, hookify, cost tracking, session save/resume, gateguard)
- Venture-specific (`ito-*`, `prediction-market-*`, `hermes-*`, `nasiko-*`, `openclaw-*`, `x402`)
- Niche domain packs (healthcare/HIPAA, supply chain/logistics, homelab, scientific, visa/legal docs) and offensive security (bug bounty)

`CURATION.md` lists every excluded skill/command with reason (170 excluded skills, 70 excluded commands at this snapshot).

### How it is generated (`scripts/build-pi-core.js`)
- Deterministic regeneration from `manifests/pi-core.json` into `pi/core/`.
- Partition completeness checks: every on-disk `skills/<dir>` and `commands/*.md` must be classified exactly once (include or exclude), and manifest entries must exist on disk.
- Copies included skill dirs (renames applied only inside profile, e.g. `council` -> `ecc-council` in copied `SKILL.md` frontmatter) and included command `.md` files; copies root `LICENSE`.
- Generates `package.json`, `README.md`, `CURATION.md`.
- Safety scans over profile content: rejects symlinks, callable non-allowlisted URLs, runtime download-and-run forms (pipe-to-shell, fetch-and-run `npx` forms/scaffolds), secrets/tokens, absolute per-user home paths; enforces `SKILL.md` frontmatter (`name == dir`, description present), no duplicate names. Scoped exceptions via manifest `safety.scanAllowlist`.
- `--check` mode rebuilds to temp and verifies committed `pi/core` is up to date (drift fails). Intended to run in CI/release flow.

### Usage (as documented)
- As package/profile: copy or install and load with Pi package mechanisms (`pi.package.json` in `pi/core`).
- README examples: `pi --no-extensions --extension pi/core` and offline RPC load test with `PI_OFFLINE=1 pi --offline --mode rpc --no-session --no-context-files --no-extensions --extension pi/core`.

## 2) Other Pi adapters/integrations in ECC (besides `pi/core`)

### `.pi/` thin adapter extension (`ecc/.pi/`)
Yes, ECC ships another Pi integration: **`.pi/extensions/index.ts` (+ `hook-runtime.js`, `.pi/README.md`)** — an adapter, not a copy of canonical assets.

- **Mounts canonical assets directly:** root `package.json` `pi` key exposes `./skills` and `./commands` to Pi (no generated copies under `.pi/`).
- **Lifecycle hook bridge:** maps Pi `session_start` -> ECC `session:start` (`scripts/hooks/session-start.js`) and Pi `session_shutdown` -> ECC `session:end:marker` (`scripts/hooks/session-end-marker.js`), executed through `scripts/hooks/run-with-flags.js` so `ECC_HOOK_PROFILE` / `ECC_DISABLED_HOOKS` apply.
- **Session context injection:** parses `hookSpecificOutput.additionalContext` from SessionStart stdout and appends it to system prompt on next `before_agent_start` inside `<ecc-session-context>`. Non-JSON tolerated.
- **Rule injection:** reads canonical `rules/common/*.md` at runtime (portable set: `coding-style`, `testing`, `security`, `git-workflow`, `patterns`, `development-workflow`, `code-review`; excludes `agents.md`, `hooks.md`, `performance.md`) and appends to system prompt in `<ecc-engineering-rules>` each turn (bounded by `MAX_RULES_BYTES`, toggleable via `ECC_PI_RULES`).
- **Diagnostics command:** `/ecc-doctor`.
- **Execution model:** resolves hook scripts relative to package (`__dirname`), runs hooks from user `cwd` (project detection), non-shell `execFile` via resolved hook runtime (`resolveHookRuntime`: explicit `ECC_HOOK_NODE` absolute path override or `node` fallback for non-Node/Bun-compiled runtimes), timeout/output limits, failures isolated (warn, never kill session).
- **Install paths (documented):** `pi install git:github.com/affaan-m/ECC` or local/path install; zero-install alternative points Pi settings at `~/.claude/skills` and `~/.claude/commands` (skills/commands only, no hook adapter/doctor).
- **Scope intentionally out:** subagent conversion/chains, structured approval gates, persistent todos, profile-based resource filtering, MCP translation. Notes community `pi-mcp-adapter` can consume ECC `.mcp.json` format without ECC changes.
- **Tests present:** `ecc/tests/pi/pi-extension-adapter.test.js`, `ecc/tests/pi/pi-package-manifest.test.js` (and related hook-runtime behavior).

### Installers / manifests
- `ecc/install.sh` / `ecc/install.ps1`: no Pi-specific install path found in quick scan; Pi install is documented via `pi install ...` in `.pi/README.md`.
- Pi manifests found: `ecc/manifests/pi-core.json` only (for `pi/core` build). No other `*pi*` manifest/adapter package manifests discovered besides `.pi` adapter + `pi/core`.

## 3) ECC hooks inventory

Primary declarations:
- `ecc/hooks/hooks.json` — main Claude-hook event graph (executable declarations consumed by Claude-side loaders/bootstrap).
- `ecc/hooks/hooks.metadata.json` — stable IDs/descriptions/fingerprints aligned by event/index (validated against `hooks.json`; `hooks.json` kept schema-clean for loader).
- Other: `ecc/hooks/codex-hooks.json`, `ecc/hooks/memory-persistence/hooks.json` (+ README) for specific harness/memory contracts.
- Runtime scripts: `ecc/scripts/hooks/*` (dispatchers, `run-with-flags.js`, hook implementations, `hook-input.js`, `pretooluse-visible-output.js`, libs under `scripts/hooks/lib` and `scripts/lib`).

### Declared events and matchers (`hooks/hooks.json`, representative)
Events present: `PreToolUse`, `PreCompact`, `SessionStart`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`.

| Event | Matcher(s) | Hook IDs (metadata) / scripts (high level) |
|---|---|---|
| `PreToolUse` | `Bash`; `PowerShell`; `Write`; `Edit\|Write`; `.*`; `Bash\|PowerShell\|Write\|Edit\|MultiEdit`; `Write\|Edit\|MultiEdit`; `^mcp__` | `pre:bash:dispatcher` -> `pre-bash-dispatcher.js`; PowerShell GateGuard (`gateguard-fact-force.js`); doc warning (`doc-file-warning.js`); suggest-compact; async observe (`observe-runner.js`); governance capture; config protection; MCP health check; edit/write GateGuard. |
| `PreCompact` | `.*` | `pre:compact` -> `pre-compact.js`. |
| `SessionStart` | `.*` (2 entries) | `session:start` -> `session-start-bootstrap.js`; `session-start:plan-canvas-sessions` -> `plan-canvas-sessions.js`. |
| `PostToolUse` | `.*` (sync + async) | `post:dispatcher:sync`, `post:dispatcher:async` -> `posttooluse-dispatcher.js` (`sync`/`async` modes). |
| `PostToolUseFailure` | `^mcp__`, `Skill` | `post:mcp-health-check`; `post:skill:track` (`skill-run-tracker.js`). |
| `Stop` | `.*` (multiple) | `stop:plan-canvas-pending`, `stop:format-typecheck`, `stop:check-console-log`, `stop:session-end`, `stop:evaluate-session` (async), `stop:cost-tracker` (async), `stop:desktop-notify` (async). Wired via lifecycle bootstrap. |
| `SessionEnd` | `.*` | `session:end:marker` -> `session-end-marker.js` (async). |

Notes: many commands embed a bootstrap snippet to resolve `CLAUDE_PLUGIN_ROOT` and run through `plugin-hook-bootstrap.js` / `lifecycle-hook-bootstrap.js` or dispatchers; several hooks go through `run-with-flags.js` with `(hookId, scriptRelPath, profiles[, timeout])`.

### Script input/output format and execution contract
- **Invocation:** most gated hooks run as `node scripts/hooks/run-with-flags.js <hookId> <scriptRelativePath> [profilesCsv]` (sometimes with extra timeout arg in lifecycle bootstrap forms). Runner resolves script under plugin root, blocks traversal, checks enablement/profile/dry-run, reads stdin, then executes hook.
- **Stdin:** raw JSON payload from harness (tool/event context). Read bounded via `scripts/hooks/hook-input.js` (`DEFAULT_MAX_STDIN` 1 MiB, clamped `ECC_HOOK_INPUT_MAX_BYTES`). On truncation runner suppresses raw passthrough, can fail-closed for specific security hooks (`pre:powershell:gateguard-fact-force`, `pre:edit-write:gateguard-fact-force`, `pre:mcp-health-check`) unless explicitly relaxed.
- **Stdout/stderr/exit:** runner drains stdout/stderr safely before exit. `exit 0` + empty stdout means “no opinion/pass-through” (except explicit outputs). `exit 2` used for blocking/deny in PreToolUse contexts by hook implementations; other non-zero treated as error per hook docs (logged, generally non-blocking depending on harness). `ECC_DRY_RUN=1` prints preview to stderr and exits 0.
- **Hook result forms (runner):** prefers `require(script).run(rawInput, context)` when exported (sync/async supported in implementation path shown) to avoid extra spawn; legacy spawn path otherwise. Resolved output can be string/buffer stdout, or object `{ stdout?, stderr?, exitCode?, additionalContext? }`. `additionalContext` is normalized into PreToolUse-visible JSON: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}` via `pretooluse-visible-output.js`.
- **Event-specific behavior examples:**
  - `session-start.js`: parses SessionStart payload/mode, selects/prunes session summaries, may emit `hookSpecificOutput.additionalContext` for context injection; capped by `ECC_SESSION_START_MAX_CHARS` / disable via `ECC_SESSION_START_CONTEXT`.
  - `session-end-marker.js`: lightweight cleanup (observer/session lease handling) and returns/pass-through output.

### `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` (from `scripts/lib/hook-flags.js`)
- **Profiles:** `minimal | standard | strict` (default `standard`). A hook runs only if current profile is in its allowed profiles (default `standard,strict` when unspecified in parser helpers).
- **Enable/disable controls:** `ECC_HOOKS_ENABLED` (master, default true), `ECC_DISABLED_HOOKS` (comma-separated hook IDs, case-insensitively normalized), `ECC_DRY_RUN`. IDs compared normalized/lowercased.
- **Precedence/fallbacks:** env vars take precedence; if absent may fall back to Claude plugin options (`CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED`, `CLAUDE_PLUGIN_OPTION_HOOK_PROFILE`) or managed `ecc/setup.json` hooks config (resolved via `ECC_HOOK_CONFIG` or plugin roots).
- **Runner enforcement:** `run-with-flags.js` skips disabled/non-matching-profile hooks (exits 0, no-op) before executing script.

## 4) ECC agents inventory

Location: `ecc/agents/*.md` (**68 agents**). Each is a Markdown agent definition with YAML frontmatter and prompt body.

### Frontmatter fields observed
- `name` — agent identifier (matches filename intent).
- `description` — when/why to use; often includes proactive/mandatory guidance.
- `tools` — comma-separated tool allowlist/capabilities (e.g. `Read, Grep, Glob`, `Read, Write, Edit, Bash, Grep, Glob`, some include MCP tools like `mcp__context7__*` or Playwright MCP tools).
- `model` — preferred model tier (`opus`, `sonnet`, `haiku`).

Examples:
- `architect`: tools `Read, Grep, Glob`, model `opus`.
- `code-reviewer`: tools `Read, Grep, Glob, Bash`, model `sonnet`.
- `planner`: tools `Read, Grep, Glob`, model `opus`.

### How agents are invoked (ECC/Claude-Code context)
- Agents are **Claude Code subagent definitions** consumable by runtimes that support agent delegation (frontmatter/tools/model align with Claude agent/task semantics).
- Invocation patterns in ECC content: commands/docs instruct to launch/invoke specific agents via the **Task tool/subagents** (e.g. GAN commands: “Launch the `gan-planner` agent via Task tool…”; build/review commands reference/invoke resolver/reviewer agents; some flows reference `Task (Explore agent)` / `subagent_type`).
- `planner`/other agent-backed flows are often optional/manual: commands may run inline and only delegate if the target subagent is available and explicitly requested.
- In Pi, there is no built-in 1:1 Task-subagent mechanism in core; `.pi/README.md` notes subagent conversion/chains are out of scope and suggests companion packages (e.g. `pi-subagents`) if desired.

## 5) Pi extension API (official docs summary, from installed docs)

Docs read: `@earendil-works/pi-coding-agent/docs/{extensions.md,packages.md,skills.md,prompt-templates.md,sdk.md,rpc.md,settings.md}`.

### Extension structure and loading
- Entry: TypeScript/JS module exporting default function `(pi: ExtensionAPI) => ...` (loaded via jiti in CommonJS mode contexts as noted by adapter/tests). Locations: user/project/CLI/global package resources per settings/packages; project extensions load under trust rules.
- `pi` manifest in `package.json` / conventional dirs expose extensions/skills/prompts/themes; `pi install/remove/list/update`, `pi -e`, `pi config` manage packages/resources.

### Commands
- `pi.registerCommand(name, { description?, handler(args, ctx) })`. Name collisions across extensions can produce suffixed invocations (load/registration order semantics documented in extensions API section).
- Extension commands run before `input` event handling for typed/RPC prompts (and conditionally for `sendUserMessage` with expansion). Slash command UX separate from prompt templates/skills.

### Lifecycle and events (key)
- Subscription: `pi.on(eventName, handler)` (unsubscribe returned). Handlers run in extension load order then registration order; composition varies by event (notification, in-place mutation, chained transform, gate, boundary, last override).
- **Input/run lifecycle:** `input` (intercept/transform/handle) -> expansion -> `before_agent_start` -> agent/turn loops -> `agent_end`/`agent_before_settle`/`agent_settled`. `session_start`/`session_shutdown`/switch/fork/compact/tree/model/thinking/ui prompt events, etc.
- **Session/context:** `session_start(reason, previousSessionFile?)`, `session_shutdown(reason, targetSessionFile?)`, `before_agent_start` (can inject message, mutate/replace system prompt via `systemPrompt`/structured `systemPromptOptions`), `context` (mutate conversation messages, no system/tool declarations), `context_with_system` (full transcript including head system message).
- **Provider hooks:** `before_provider_headers`, `before_provider_request` (inspect/replace payload), `after_provider_response`, `provider_stream_event`.

### Intercepting/blocking/mutating tool calls
- `tool_call` (after `tool_execution_start`, before execution): **can block** with `{ block: true, reason?, terminate? }`; `event.input` is mutable and mutations affect actual execution and later handlers. Use `isToolCallEventType(...)` for typed narrowing.
- `tool_result` (after execution, before end/final result emission): can modify/patch result (`content`, `details`, `structuredContent`, `isError`, `usage`), chained middleware semantics.
- Tool execution lifecycle events: `tool_execution_start/update/end` (parallel-tool ordering caveats documented).

### Registering tools
- `pi.registerTool(def)` callable by LLM (name, label, description, parameters schema e.g. TypeBox, `execute(toolCallId, params, signal, onUpdate, ctx)`, optional rendering/prompt metadata like `promptSnippet`, `promptGuidelines`, `defaultActive`, exposure). Can be registered at load or dynamically later; runtime activation controllable via `pi.setActiveTools(...)`.

### Model selection and model-related APIs
- `pi.setModel(model)` (async success), `model_select` event on changes (not on session restore; check `ctx.model` in `session_start`), `thinking_level_select` notification.
- Context: `ctx.model`, `ctx.thinkingLevel`, `ctx.modelRegistry` (find/providers/auth/streaming helpers `streamSimple`/`complete`, typed/classifier/image helpers), `ctx.scopedModels`.
- Virtual/selectable catalog entries via `pi.registerVirtualModel` / related APIs (per docs section headings).

### Launching child sessions (SDK/RPC or processes)
- **SDK (in-process, Node/Bun):** `createAgentSession()` from `@earendil-works/pi-coding-agent`; owns conversation/model/tools/compaction/extensions; `session.prompt(...)`, `session.subscribe(...)`, `SessionManager` for persistence/open/continue/fork/list patterns (see `docs/sdk.md` + `examples/sdk/*`). Subscriptions must be rebound after runtime replacement.
- **RPC (child process, JSONL over stdin/stdout):** `pi` in RPC mode; protocol of commands/responses/events framed as records; `RpcClient` available in TS; stdout reserved for protocol, stderr for diagnostics; close stdin for orderly shutdown. Use for language-independent or isolated integrations.
- **CLI subprocess alternatives:** print/JSON modes for simpler integrations (`docs/cli-integration.md`). Extensions/tools can also spawn external processes via normal Node APIs when needed (with trust/sandbox considerations).

## 6) Gap table: ECC vs `pi/core` and Pi primitives to cover

| ECC capability (not covered by `pi/core`) | Current state | Pi primitives / path to cover | Notes / constraints |
|---|---|---|---|
| Lifecycle/session hooks (SessionStart/End, Pre/Post tool, Stop, PreCompact) | Excluded from `pi/core`; partially bridged by `.pi` adapter (start/end + context injection only) | `pi.on(...)` events (`session_start/shutdown`, `tool_call/tool_result`, `tool_execution_*`, `turn_end/agent_*`, `before_agent_start`, `context*`, provider hooks, etc.), `pi.registerCommand`, extension-side file/process logic | Event taxonomy differs from Claude hooks; not all Claude hook semantics/map 1:1 (e.g. blocking/format of outputs, Stop/PreCompact timing). Need per-hook adaptation and safe sandboxing. |
| Hook profiles/disable flags parity (`ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS`) | Implemented in ECC runner; `.pi` reuses runner for bridged hooks | Reuse `scripts/hooks/run-with-flags.js` + env handling; expose status/controls via extension command/UI (`/ecc-doctor`, config) | Keep behavior consistent with `scripts/lib/hook-flags.js` precedence/fallbacks. |
| Rich hook side effects (formatting, typecheck, governance capture, gateguard, cost tracking, notifications, etc.) | Present in ECC hook scripts but not generally wired into Pi | Selective port: subscribe to closest Pi events, call existing scripts or reimplement; use `tool_call` blocking/mutation and `tool_result`/turn-end boundaries | Many scripts assume Claude hook payloads/IDs/dispatchers; require payload translation and careful non-blocking/error isolation. |
| Agents (68 markdown agent defs with tools/model) & subagent orchestration | Excluded from `pi/core`; commands often reference Task/subagents | No core subagent registry equivalent; options: (a) ship as skills/prompts guidance, (b) companion package like `pi-subagents`, (c) SDK/RPC child sessions + custom `registerTool` to delegate | Tool/model frontmatter semantics are Claude-specific; need mapping or degraded single-agent behavior. |
| Agent-invoking commands (gan-*, orch-*, *-build/*-review delegators, multi-*, etc.) | Mostly excluded from `pi/core` | Convert to prompt templates that run inline, or implement orchestration via extension tools/commands + child sessions | Preserve UX where possible; mark blocked when delegation/runtime unavailable. |
| Continuous learning / instincts / session save-resume / cost tracking / hookify | Excluded (Claude-code-only mechanics) | Extensions with `appendEntry`/session events/filesystem state, custom commands/tools, scheduled/background logic as feasible | Portability/privacy/storage design required; some depend on Claude-specific transcripts/paths. |
| MCP integrations bundled in ECC configs | Not bundled/translated by `.pi`; `pi-mcp-adapter` can read configs | Use community `pi-mcp-adapter` or implement `mcp_servers_change`/tool exposure in extension | Core Pi has no MCP surface; credentials and headless init caveats. |
| SaaS/ops/commercial/domain-pack skills & commands | Intentionally excluded from `pi/core` | Out of scope for core profile; possible opt-in packages with explicit deps/keys if ever needed | Conflicts with `pi/core` safety/portability goals. |
| Full command parity (94 vs 24 prompt commands) | Only 24 shipped in `pi/core` | Generate/adapt prompt templates (`prompts/*.md`) with argument/routing adjustments; invoke skills by name for shim commands; document blocked ones | This task begins that conversion via `prompts/`, allowlist, build script, and blocked-command tracking. |

## Open questions

1. **Prompt-template “skill invocation”:** Pi prompt templates expand text; there is no documented include primitive. For shim commands, should templates instruct the model to run `/skill:<name>` (user command) or to `read` the skill’s `SKILL.md` path and follow it? (Impacts automation/reliability.)
2. **Argument syntax parity:** ECC commands may assume Claude-specific `$ARGUMENTS`/phrasing; Pi templates support `$1`, `$@/$ARGUMENTS`, `${...}` substitutions—needs consistent adaptation rules per command.
3. **Agent delegation parity:** which subset of agent-backed commands must be made inline vs. delegated via `pi-subagents`/child sessions, and what is the minimum acceptable behavior when delegation is unavailable?
4. **Hook payload translation:** mapping Claude hook stdin/event schemas to Pi event payloads (`tool_call`, `before_agent_start`, etc.) for scripts expecting ECC/Claude formats—how much adapter glue vs. script rewrites?
5. **`.pi` adapter vs `pi/core` package roles:** when installed together, how should rule injection, commands, and skills be deduplicated/configured to avoid prompt bloat or conflicts?
6. **SDD artifact paths:** ECC commands reference `.claude/...` paths; for Pi-local workflow should we keep `.claude/...` compatibility, move to project-local dirs, or make configurable?
7. **Testing “3 templates load and execute in pi”:** in this environment, `pi --offline ...` behavior and non-interactive execution affordances need a concrete, repeatable verification method (RPC/print/interactive smoke) without touching `~/.pi`.

## Staged plan (hooks, agents, SDD flow)

### Stage 0 — Baseline (done/ongoing)
- Keep `pi/core` as safe portable baseline (skills+prompts). Maintain `.pi` thin adapter for SessionStart/End context + rule injection + diagnostics.
- Establish generated prompt pipeline for selected ECC commands (`scripts/build-prompts.ts`, `config/commands-allowlist.json`, `prompts/`, docs).

### Stage 1 — Command/SDD prompt parity
- Convert SDD and quality commands (spec/plan/implement/review/verify, quality-gate, TDD) into Pi prompt templates with harness adaptations and explicit “adapted” headers.
- Replace Claude-only agent calls with inline steps or skill invocations where possible; mark and document blocked commands (subagents/hooks/MCP) in `docs/pi-port/02-commands.md`.

### Stage 2 — Hook bridge expansion
- Prioritize high-value, safe hooks: map to Pi events (`tool_call` for pre-tool gates, `tool_result`/`agent_end` for post checks, `before_agent_start` for context/rules) with payload adapters around existing scripts where feasible.
- Preserve `ECC_HOOK_PROFILE`/`ECC_DISABLED_HOOKS` semantics and failure isolation; add observability (`/ecc-doctor` extensions).

### Stage 3 — Agent/delegation strategy
- Define portability tiers: inline prompt workflows (default), optional `pi-subagents` integration, or SDK/RPC child-session delegation tool for selected roles.
- Normalize agent metadata usage (tools/model hints) into Pi-compatible instructions/config where meaningful.

### Stage 4 — SDD workflow integration
- Compose end-to-end SDD flow in Pi: spec -> plan -> implement -> review -> verify, with quality gates/TDD hooks or commands; align artifact locations and handoffs.
- Add repeatable verification (smoke scripts/tests) and document supported/unsupported paths.
