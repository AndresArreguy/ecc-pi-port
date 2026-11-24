# SDD Flow Port to Pi (`extensions/ecc-sdd.ts`)

## Pi docs consulted (no invented APIs)

Read from installed Pi docs (`@earendil-works/pi-coding-agent/docs`):
- `extensions.md` — extension API/events/commands, `pi.registerCommand`, `pi.setModel`, `pi.setThinkingLevel/getThinkingLevel`, `ctx.modelRegistry.find(...)`, `ctx.sendUserMessage(...)` / `pi.sendUserMessage(...)`, `ctx.model`, `ctx.sessionManager`, `message_end`/`agent_end`/`agent_settled` events, extension command handling.
- `settings.md` — model/thinking/defaultTools/settings behavior (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`, scoped/enabled models, etc.).
- `models.md` — model/provider selection and authentication concepts (`/model`, `/login`, provider/model availability).
- `rpc.md`, `rpc-commands.md`, `json.md` — `prompt` command can invoke extension slash commands (`disposition: handled`), event stream and usage/cost fields on assistant messages.

**APIs used (as documented):** `registerCommand`, `setModel`, `setThinkingLevel`, `ctx.modelRegistry.find(provider, id)`, `ctx.sendUserMessage` (fallback `pi.sendUserMessage`), event listeners `message_end` and `agent_settled` (with `agent_end` awareness), and assistant `message.usage`/`message.usage.cost` accumulation when exposed.

## Artifacts

- `extensions/ecc-sdd.ts` — SDD extension (commands, model switching, prompts, cost tracking).
- `config/sdd-models.json` — configurable per-phase models (not hardcoded).
- `tests/pi-port/test-sdd-rpc.mjs` — RPC-based flow test harness.
- `.pi-port/test-sdd-project/` — small test project used for flow validation.
- `docs/pi-port/05-sdd.md` — this document.

## Configuration (`config/sdd-models.json`)

Phases and configured models used in validation (provider `commandcode`, discovered via `pi --list-models`):

| Phase | Provider | Model | Thinking | Tier / intent |
|---|---|---|---|---|
| `spec` | commandcode | `claude-opus-4-8` | high | strong (spec) |
| `plan` (architecture) | commandcode | `claude-opus-4-8` | high | strong (plan/architecture) |
| `implement` | commandcode | `deepseek/deepseek-v4.1-flash-fast` | null | cheap, good cache-pricing intent (implementation) |
| `review` | commandcode | `gpt-5.4` | medium | different family than implementation |
| `verify` | commandcode | `google/gemini-3.5-flash` | medium | different family than implementation |
| `light` | commandcode | `gpt-5.4-mini` | low | minimal (explore/summarize/commits) |

Aliases: `architecture/specify/planning/implementation/verification` → canonical phases.

### Agents (`config/agents-models.json`)

Subagent model pins live in a separate file so runtime limits stay hand-editable:

```json
{
  "defaults": { "maxTurns": 25, "timeoutMs": 600000, "maxParallel": 3 },
  "agents": {
    "tdd-guide": { "model": null, "provider": null, "thinking": null, "maxTurns": 40, "timeoutMs": 900000 }
  }
}
```

The `/ecc-models` screen edits `provider`/`model`/`thinking` per agent (the agents
section, reached with `Tab`) and never touches `maxTurns`/`timeoutMs`/`comment`. The
roster comes from `config/agents-generated.json`, so an agent without a pin still
appears in the list. An unset pin means the child inherits the session's
provider/model. Limits are *not* part of a profile. `A` in the agents section
applies one model to the whole (possibly filtered) list, so pinning all 68 at once
is a single picker.

### Profiles (named presets)

The same file stores named presets under `profiles` and the last loaded preset in
`activeProfile`:

```json
{
  "activeProfile": "barato",
  "phases": { "spec": { "provider": "commandcode", "model": "m1", "thinking": "high" } },
  "phaseAliases": { "architecture": "plan" },
  "profiles": {
    "barato": {
      "updatedAt": "2026-11-16T12:00:00.000Z",
      "phases": {
        "spec": { "provider": "commandcode", "model": "cheap", "thinking": "low" },
        "implement": { "provider": "commandcode", "model": "cheaper", "thinking": "low" }
      }
    }
  }
}
```

- Saving a profile snapshots the current `phases` and the model pin of every
  subagent; later edits to the live config do not mutate the preset (deep copy).
- Loading a profile merges its phases into the live config and applies the agent pins
  it carries; agents absent from the snapshot keep their current pin.
  Phases missing from the preset are left untouched.
- Profile names are case-insensitive for lookup and keep the stored casing.
- `ECC_PI_SDD_CONFIG` overrides the config path (useful for tests and per-project setups).

### Language

Pi has no TUI locale, so the extension resolves its own language:

```text
ECC_PI_SDD_LANG  >  language in config/sdd-models.json  >  system locale
```

- `language` accepts `auto`, `es`, or `en`; `auto` (default) detects `LANG`/`LC_ALL`
  and falls back to `Intl.DateTimeFormat().resolvedOptions().locale`.
- Spanish locales resolve to Spanish; every other locale resolves to English.
- UI chrome, notifications and validation messages are translated. Phase names
  (`spec`, `implement`, …) and profile names are data and stay unchanged.

## Commands

- `/ecc-models` (legacy aliases `/sdd-model`, `/sdd-models`) — interactive menu when UI is available:
  edit all SDD phases **and every subagent's model pin** on one screen, load/save/delete
  profiles, or show the config.
- `/ecc-models profiles` — list saved profiles with a compact phase summary.
- `/ecc-models save <name>` — save the current phases as a named profile and activate it.
- `/ecc-models load <name>` — load and activate a saved profile.
- `/ecc-models delete <name>` — delete a saved profile.
- `/ecc-models language [auto|es|en]` — show or change the UI language (`lang` and
  `idioma` are accepted aliases).
- `/ecc-models <phase> <provider> <model> [thinking]` — set one phase (also clears
  `activeProfile`, because the config no longer matches a preset exactly).
- `/ecc-models <phase> clear` — remove the provider/model/thinking override for a phase.
- `/ecc-models agents <provider> <model> [thinking]` — pin **every** subagent in the
  roster to one model in one shot (thinking is only written when you pass it).
- `/ecc-models agents clear` — remove provider/model/thinking from every subagent.
- `/sdd-spec <feature> <request...>` — switch to `spec` model, prompt phase, target `specs/<feature>/spec.md`.
- `/sdd-plan <feature>` — switch to `plan` model, read prior artifact(s), target `plan.md` + `tasks.md`.
- `/sdd-implement <feature> [focus]` — switch to `implement` model, task-by-task execution from `tasks.md`, tests-before-code, mark `- [ ]` → `- [x]` in `tasks.md`.
- `/sdd-review <feature>` — switch to `review` model, capture git diff, contrast diff vs `spec.md`/`plan.md` (edge cases, constraints, invented dependencies), target `review.md`.
- `/sdd-verify <feature> [focus]` — switch to `verify` model, run checks against spec/plan/tasks/review, target `verify.md`.

### Single-screen editor

With a TUI, choosing “Editar modelos por fase (pantalla única)” renders two sections.
The first one lists every phase
(`spec`, `plan`, `implement`, `review`, `verify`, `light`) with its model and thinking
level; `Tab` switches to the agents section, which lists every agent from the
generated subset (see `config/agents-generated.json`) with the same two columns and
writes to `config/agents-models.json`. Navigation and shortcuts:

| Key | Action |
|---|---|
| `Tab` (or `Ctrl+T` if the app swallows Tab) | Switch between the *phases* and *agents* sections |
| `↑` / `↓` | Move between rows |
| `PgUp` / `PgDn` | Jump a page in the agents section |
| `/` | Filter agents by name (agents section only) |
| `←` / `→` | Move between the Model and Thinking columns |
| `Enter` | Edit the selected cell (searchable model picker or thinking list) |
| `A` | Pick one model and apply it to **every row in the list** (agents section only) |
| `T` | Pick one thinking level and apply it to **every row in the list** (agents section only) |
| `Ctrl+S` | Persist to `config/sdd-models.json` **and** `config/agents-models.json` |
| `Ctrl+P` | Save the current config as a named profile (phases + agent pins) |
| `Esc` | Close the editor; unsaved edits are discarded (with a warning) |

The editor follows the resolved language. The main menu also has an
`Idioma / Language…` entry that persists the choice in `config/sdd-models.json`.

The model picker supports fuzzy search, “sin override”, and a manual
`provider/model` entry for models missing from the registry. Escaping with unsaved
changes does not autosave; `Ctrl+S` is the explicit save.

`A` (model) and `T` (thinking) are the bulk path: they open the same picker scoped
to the whole visible list, so one choice pins all 68 subagents at once — and after
`/` the bulk still respects the filter, which is how you pin only the reviewers or
only the writers. The picker header says how many agents the choice will hit and
`(mixed)`/`(distintos)` when the list does not share one value. Thinking is left
alone when you only swap models from the CLI.

Feature names are slugified and used as `specs/<feature>/...`; current feature is persisted in `specs/.sdd-state.json` (project cwd).

## Phase execution model

For each phase command, the extension:
1. Resolves feature/args and ensures `specs/<feature>/` exists.
2. Switches model via `ctx.modelRegistry.find(provider, model)` + `pi.setModel(...)` (+ `pi.setThinkingLevel` if configured). If no model configured, it proceeds without forcing a model change (labelled unchanged); if configured model cannot be set/found, it aborts with notification.
3. Builds a **self-contained prompt** specifying phase, cwd, feature artifact dir, **explicit prior artifact files to read only**, required outputs, and phase rules; for `review` it captures and embeds current git diff (`git diff`/staged/status fallback).
4. Starts phase cost tracking and dispatches the prompt with `ctx.sendUserMessage(...)` to trigger the agent turn on the selected model.
5. Accumulates assistant `message.usage`/`cost` on `message_end` events and finalizes on `agent_settled`, appending a row to `specs/<feature>/costs.md`.

**Context discipline:** prompts explicitly instruct “read ONLY the artifact file(s) listed…” and not to rely on prior conversation. This is **prompt-level isolation** (best-effort). Prior conversation may still exist in session history unless a fresh session/branch strategy is used; prompts are designed to be artifact-driven and self-contained.

**Artifacts by phase:**
- `spec` → reads request args → writes `spec.md`.
- `plan` → reads `spec.md` → writes `plan.md`, `tasks.md`.
- `implement` → reads `spec.md`, `plan.md`, `tasks.md` → updates repo + marks tasks in `tasks.md` (test-first, task-by-task as instructed).
- `review` → reads `spec.md`, `plan.md`, (`tasks.md` if present) + captured diff → writes `review.md` (edge cases, constraints, invented deps, risks/tests/regressions).
- `verify` → reads `spec.md`, `plan.md`, (`tasks.md`, `review.md` if present) → runs checks and writes `verify.md`.

## Cost/usage tracking

- Source: assistant `message.usage` (`input/output/cacheRead/cacheWrite/totalTokens`) and `message.usage.cost` (`input/output/cacheRead/cacheWrite/total`) when exposed by Pi/provider.
- Recorded per phase run in `specs/<feature>/costs.md` (table: phase, command, status, timestamps, model, token/cost totals, message count). Notes appended when present.
- If usage/cost is absent or zero in provider error responses, records reflect observed values (zeros in this test). Availability/accuracy depends on what Pi/provider exposes.

## Validation / test

### Load & command wiring
- `pi --offline --mode rpc ... -e ./extensions/ecc-sdd.ts` → **loaded (exit 0)** (also with `ecc-agents.ts`).
- RPC prompt `/ecc-models` → **handled**, notified full phase config summary.

### Full flow test (test project)
- **Project:** `.pi-port/test-sdd-project/` (`package.json`, `src/server.mjs`, `tests/placeholder.test.mjs`).
- **Feature:** `add-user-endpoint` — “POST /users endpoint with validation” (`{name,email,age}` rules, 201/400 behavior), executed via `tests/pi-port/test-sdd-rpc.mjs` (`pi --mode rpc -e extensions/ecc-sdd.ts`, cwd=test project), phases run sequentially.
- **Observed mechanics (worked):** all commands handled (`disposition: handled`), per-phase model switch/start notifications with configured provider/model/thinking, self-contained prompts with correct artifact-only inputs per phase, review captured git diff, feature dir + `specs/.sdd-state.json` created, `specs/add-user-endpoint/costs.md` written/finalized per phase on `agent_settled`.
- **Observed failures (LLM execution blocked by provider/plan/rate limits):**

| Phase | Configured model | Result / failure |
|---|---|---|
| `spec` | `commandcode/claude-opus-4-8` (thinking=high) | **Completed (run finalized) but assistant error:** `403 permission_error` `MODEL_NOT_IN_PLAN: Claude Opus 4.8 available in Provider and above plans or extra on demand usage` (1 assistant message, usage 0). No `spec.md` produced. |
| `plan` | `commandcode/claude-opus-4-8` (thinking=high) | **Assistant error:** `403 permission_error` `MODEL_NOT_IN_PLAN` (same). No `plan.md`/`tasks.md` produced. |
| `implement` | `commandcode/deepseek/deepseek-v4.1-flash-fast` | **Assistant errors with retries:** `429 rate_limit_error` `RATE_LIMITED` “weekly usage limit…” (reset `2026-11-13T19:00:31.824Z`), `willRetry` then `auto_retry_end success=false`; 4 assistant error messages counted. No code/tests/tasks updates produced. |
| `review` | `commandcode/gpt-5.4` (thinking=medium) | **Assistant error:** `403 permission_error` `MODEL_NOT_IN_PLAN: GPT-5.4 available in Pro and above plans or extra on demand usage`. No `review.md` produced. |
| `verify` | `commandcode/google/gemini-3.5-flash` (thinking=medium) | **Assistant error:** `403 permission_error` `MODEL_NOT_IN_PLAN: Gemini 3.5 Flash available in Pro and above plans or extra on demand usage`. No `verify.md` produced. |

- **Cost records written:** `.pi-port/test-sdd-project/specs/add-user-endpoint/costs.md` contains rows for all 5 phases (spec/plan/review/verify: 1 msg, implement: 4 msgs due to retries) with zero token/cost totals as reported.
- **Artifacts not produced:** `spec.md`, `plan.md`, `tasks.md`, `review.md`, `verify.md` absent because no successful model/tool-executing responses occurred.

## Limitations / notes

- **Environment-dependent execution:** end-to-end content generation depends on configured/authenticated models and plan/quota availability; this validation hit 403/429 provider constraints (not adapter load/switch/prompt/cost-recording failures).
- **Context isolation not hard-enforced:** phases instruct artifact-only reading but do not truncate/prune session history; for strict isolation, run phases in fresh sessions or add session-branch/reset strategy (subject to Pi API support).
- **Cost accuracy:** depends on Pi/provider exposing `usage`/`cost`; error responses reported zero usage here.
- **Model switching scope:** `pi.setModel`/thinking apply to the session; extension assumes command-context APIs as documented. If models are unconfigured/unavailable, phases abort or run without forced switch per config.
- **Implement/verify quality:** actual TDD loop, task marking, and verification depend on model/tool behavior following prompts; not fully behavior-validated here due to LLM failures.
- **Review diff source:** uses current git diff/status snapshot at phase start; may include unrelated workspace changes in this test environment.
- **Concurrency/state:** single in-memory active phase tracker; overlapping phase runs finalize previous as interrupted (best-effort).

## How to run

1. Configure phases: `/ecc-models` (or `/sdd-models`) on one screen, or edit
   `config/sdd-models.json`. Save/load named presets with `Ctrl+P` in the editor or
   `/ecc-models save|load|delete|profiles`. Change the language with
   `/ecc-models language auto|es|en`.
2. Start Pi with extension: `pi -e ./extensions/ecc-sdd.ts` (from repo/project context).
3. Run phases (example): `/sdd-spec <feature> <request>`, `/sdd-plan <feature>`, `/sdd-implement <feature>`, `/sdd-review <feature>`, `/sdd-verify <feature>`.
4. Inspect outputs in `specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`, `review.md`, `verify.md`, `costs.md`).
