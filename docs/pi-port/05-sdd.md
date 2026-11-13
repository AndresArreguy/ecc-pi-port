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

## Commands

- `/sdd-model` — show config, or set/clear: `/sdd-model <phase> <provider> <model> [thinking]`, `/sdd-model <phase> clear`.
- `/sdd-spec <feature> <request...>` — switch to `spec` model, prompt phase, target `specs/<feature>/spec.md`.
- `/sdd-plan <feature>` — switch to `plan` model, read prior artifact(s), target `plan.md` + `tasks.md`.
- `/sdd-implement <feature> [focus]` — switch to `implement` model, task-by-task execution from `tasks.md`, tests-before-code, mark `- [ ]` → `- [x]` in `tasks.md`.
- `/sdd-review <feature>` — switch to `review` model, capture git diff, contrast diff vs `spec.md`/`plan.md` (edge cases, constraints, invented dependencies), target `review.md`.
- `/sdd-verify <feature> [focus]` — switch to `verify` model, run checks against spec/plan/tasks/review, target `verify.md`.

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
- RPC prompt `/sdd-model` → **handled**, notified full phase config summary.

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

1. Configure phases: `/sdd-model` or edit `config/sdd-models.json`.
2. Start Pi with extension: `pi -e ./extensions/ecc-sdd.ts` (from repo/project context).
3. Run phases (example): `/sdd-spec <feature> <request>`, `/sdd-plan <feature>`, `/sdd-implement <feature>`, `/sdd-review <feature>`, `/sdd-verify <feature>`.
4. Inspect outputs in `specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`, `review.md`, `verify.md`, `costs.md`).
