# ECC Agents Port to Pi (`extensions/ecc-agents.ts`)

## Scope and artifacts

- **Extension:** `extensions/ecc-agents.ts` — registers `run_agent` tool.
- **Subset/source of truth:** `config/agents-subset.json` (all 68 agents in `ecc/agents/`: 28 with `write`/`edit`, 40 read-only).
- **Generated agent data:** `config/agents-generated.json` (from `./ecc/agents/*.md`, not hand-authored).
- **Per-agent model + runtime config:** `config/agents-models.json` — model pins (editable from the `/ecc-models` agents section) and runtime limits (`maxTurns`, `timeoutMs`, `maxParallel`). The selector only ever writes `provider`/`model`/`thinking`; limits and comments are preserved. Profiles saved with `/ecc-models` snapshot the pins of every agent in the subset.
- **Generator:** `scripts/build-agents.ts`.
- **Regeneration:** `npm run build` (regenera todo) o `npm run build:agents` (solo este archivo).

## Pi docs: native subagent support (confirmed)

Checked installed Pi documentation (`@earendil-works/pi-coding-agent/docs`):

- **No native/core subagent primitive documented** comparable to Claude Code's built-in Task/subagent delegation. I did not find a core CLI flag or built-in tool that natively launches named subagents with isolated context as a first-class Pi feature.
- **`docs/extensions.md`** references a `subagent/` example extension pattern that can spawn sub-agents using `registerTool` and `exec` (extension-level pattern, not native core behavior).
- **`docs/environment-variables.md`** mentions `PI_CODEMODE_MAX_WORKERS` in relation to "in-process subagents" (codemode workers), which is not the same as named ECC-agent delegation sessions.
- **`docs/sdk.md`** documents in-process Node.js/Bun integration via `createAgentSession()` / `AgentSession` (programmatic session lifecycle/state/storage).
- **`docs/rpc.md`** documents running Pi as a long-lived subprocess controlled via JSONL stdin/stdout (`--mode rpc`) and suggests `RpcClient` for subprocess-based TypeScript integration.
- **`docs/cli.md` / `docs/json.md`** document one-shot subprocess modes: print/JSON event stream (`-p`, `--mode json`) with isolation and control flags such as `--no-session`, `--system-prompt`/`--append-system-prompt`, `--tools`, `--exclude-tools`, `--no-tools`, `--model`, `--provider`, `--thinking`, `--no-extensions`.

**Conclusion:** native subagent delegation is not provided as a core built-in in the checked Pi docs; isolated agent execution must be implemented via an extension using supported subprocess or SDK mechanisms.

## Approach options and chosen design

| Option | Pros | Cons | Fit |
|---|---|---|---|
| **Child `pi` process (print/JSON mode)** | Strong process isolation; easy CLI control of prompt/tools/model/session; no shared in-process state; final output capturable from stdout/event stream; simple timeout/kill and parallel semaphore; minimal integration surface | Process startup overhead; CLI flag/API surface dependency; no direct in-process object access; turn-limit enforcement depends on observable events | **Chosen (simplest)** |
| **RPC subprocess (`--mode rpc` + protocol/client)** | Bidirectional control, streaming commands, richer lifecycle control | More protocol/state handling complexity; requires implementing/using RPC message flow correctly | Viable, more complex than needed |
| **In-process SDK (`createAgentSession`)** | Programmatic control in same process, potentially finer-grained APIs | Higher integration complexity; must carefully isolate state/tools/extensions; less OS-level isolation | Viable, more complex/riskier for isolation |

**Implementation:** `run_agent` spawns an isolated child `pi` process in `--mode json` (`-p`, `--no-session`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`) with the ECC agent body as `--system-prompt`, Pi-mapped tool allowlist via `--tools` (or `--no-tools`), and optional model overrides from config. The extension parses JSONL events, tracks turns, captures the final assistant message, enforces limits, and returns **only the final result** (plus run metadata/stderr tail) to the main session.

To avoid Windows `.cmd` shim spawning issues, the extension resolves and runs the Pi CLI bundle directly with `process.execPath` (`.../@earendil-works/pi-coding-agent/dist/bundle/cli.js`) when available, with fallbacks.

## Agent generation and mapping

`scripts/build-agents.ts` reads `config/agents-subset.json`, parses frontmatter/body from `ecc/agents/<name>.md`, and generates `config/agents-generated.json` with:

- `name`, `description`, `model` (ECC default tier), `source`
- `eccTools` (from frontmatter)
- `piTools` (mapped allowlist for `--tools`)
- `unmappedTools` (reported, not passed)
- `systemPrompt` (agent markdown body, including ECC prompt-defense baseline)

**ECC → Pi tool mapping used:**

| ECC/Claude tool | Pi tool(s) |
|---|---|
| `Read` | `read` |
| `Grep` | `grep` |
| `Glob` | `find`, `ls` |
| `Bash` | `bash` |
| `Write` | `write` |
| `Edit` | `edit` |
| Unknown/MCP (`mcp__*`) | not mapped; recorded in `unmappedTools` |

## Delegation routing (intent → agent)

Delegation is intent-based, not a manual flag: `lib/ecc-agent-routing.ts` holds the
table and `extensions/ecc-agents.ts` renders it into the `run_agent`
`promptGuidelines`, so the routing travels with the tool (and survives compaction)
instead of relying on the model remembering a doc.

| Intent cue (es / en) | Agents, in order |
|---|---|
| "hagamos un plan", "planificá" | `planner` (read-only) |
| "vamos a encarar esta feature", "implementá" | `code-explorer` → `architect` (only for schema/contract calls) → `tdd-guide` → `code-reviewer` |
| "arreglá el bug", "por qué falla" | `tdd-guide` (reproducing test first) |
| "arreglá el build", "typecheck roto" | `build-error-resolver` |
| "revisá esto", después de escribir código | `code-reviewer`, or the stack reviewer (`react-reviewer`, `typescript-reviewer`, …) |
| auth, permisos, secretos, inputs de usuario | `security-reviewer` (adds to review, never replaces it) |
| "limpiá", "refactorizá" | `code-simplifier` → `refactor-cleaner` → `code-reviewer` |
| "está lento", performance | `performance-optimizer` |
| accesibilidad, a11y | `a11y-architect` |
| "faltan tests", cobertura | `pr-test-analyzer` → `tdd-guide` |
| "actualizá la doc", README | `doc-updater` |
| "¿está listo para prod?", auditar | `security-reviewer` → `code-reviewer` + the project gate |

Rules that ship with the table: one-line changes and typos stay inline; read-only
routes run in parallel but two agents never write the same file; every brief carries
exact paths and the done criterion; the child does not know the project gate, so the
main session runs it before reporting anything as done.

`tests/pi-port/agent-routing.test.ts` asserts every routed agent exists in
`config/agents-generated.json`, that the rendered block stays under 22 lines, and that
the generated prompt templates carry no anti-delegation leftovers.

## `run_agent` tool contract

- **Parameters:** `agent` (string, required), `task` (string, required), `cwd?` (string), `context?` (string).
- **Behavior:** validates agent exists in generated subset, resolves limits/model config, acquires parallel slot, runs isolated child session, releases slot, returns formatted final result and details.
- **Isolation:** child runs with `--no-session` and without parent extensions/skills/prompt templates/themes; system prompt is the selected ECC agent prompt.
- **Result to main session:** final assistant text only (captured from JSON `message_end`/`turn_end`/`agent_end`), not the full child transcript/event stream.

## Configuration (`config/agents-models.json`)

```json
{
  "defaults": { "maxTurns": 12, "timeoutMs": 300000, "maxParallel": 2 },
  "agents": {
    "planner": { "provider": null, "model": null, "thinking": null },
    "build-error-resolver": { "provider": null, "model": null, "thinking": null }
  }
}
```

- **`provider` + `model`:** passed as `--provider` and `--model` to child `pi`.
- **`model` only:** passed as `--model`.
- **`thinking`:** passed as `--thinking` when set.
- **`null` values:** no explicit override (child uses its resolved/default model/config). ECC frontmatter model tiers (`opus`/`sonnet`) are recorded in generated data but not auto-translated to concrete Pi provider model IDs.
- **Limits:** `defaults.maxTurns`, `defaults.timeoutMs`, `defaults.maxParallel`; per-agent `maxTurns`/`timeoutMs` overrides supported.

## Limits and enforcement

- **`maxParallel` (configurable):** in-extension semaphore; extra `run_agent` calls wait for a slot.
- **`timeoutMs` (configurable):** child process killed on timeout (`SIGTERM`, then `SIGKILL` fallback); run reported as timeout.
- **`maxTurns` (configurable):** counted from JSON `turn_end` events in child stream; when reached, child process is terminated and run reported as `turn_limit_reached` with best captured partial/final text.
- **Abort propagation:** best-effort kill on parent tool signal abort.

## Validation and tests

### Extension/tool load

- `printf '' | pi --offline --mode rpc --no-session --no-context-files --no-extensions -e ./extensions/ecc-agents.ts` → **exit 0** (extension loaded).

### Child subprocess mechanism (JSON mode)

- Direct child run: `node <pi-cli-bundle> --mode json -p --no-session --no-extensions --no-skills --no-prompt-templates --no-themes --no-tools --system-prompt ... <task>` emitted expected JSONL records (`session`, `agent_start`, `turn_start`, `message_*`, `turn_end`, `agent_end`, `agent_settled`) confirming the spawn/parse model used by `run_agent`. In this environment the model call failed with provider error (see below), but process/event lifecycle was validated.

### Requested behavioral tests (blocked by environment)

- **`planner` on a short spec** (via `pi -p ... -e ./extensions/ecc-agents.ts` instructing use of `run_agent`): **blocked** — main session returned `402: {"message":"Insufficient Balance ...","type":"insufficient_balance_error","param":null,"code":"invalid_request_error"}` before delegating.
- **`code-reviewer` on a real diff** (diff of `.pi-port/review-before.js` → `.pi-port/review-after.js` including SQL concatenation, weak zero check, and `eval`): **blocked** — same `402 insufficient_balance_error` in main session.

These are provider/balance limitations in this environment (consistent with earlier prompt-template execution tests), not evidence that agent definitions or the adapter failed to load. Re-run in an environment with an available configured model to complete behavioral validation.

## Limitations vs Claude Code native subagents

- **No native Task/subagent runtime:** implemented as an extension spawning child `pi` processes; not a core Pi feature.
- **Context isolation is process-level, not Claude Task-tool semantics:** child receives only constructed task/context and its agent system prompt; it does not automatically inherit the full parent conversation, Claude-specific tool semantics, or Claude Code permission UX.
- **Tool parity is partial:** ECC frontmatter tools are mapped to Pi built-ins (`read/grep/find/ls/bash/write/edit`). MCP tools and other Claude-specific tools are not automatically available/mapped (reported as `unmappedTools`).
- **Model tier mapping not automatic:** ECC `model: opus|sonnet|...` tiers are not translated to concrete `provider/model` IDs; configure `config/agents-models.json` for deterministic per-agent model selection.
- **Turn limit granularity:** enforced by counting `turn_end` events and terminating the child (hard stop), not by a native Pi per-session max-turn CLI guarantee.
- **Cost/latency:** each `run_agent` call starts a separate `pi` process and model interaction; no shared warm in-process agent state.
- **Result fidelity:** main session gets final assistant text (plus metadata/stderr tail), not the child’s full structured transcript/artifacts unless the agent includes them in its final response.
- **Environment-dependent behavior:** depends on local `pi` installation/models/auth/balance; project-context injection and other Pi defaults may still apply inside child sessions as configured by Pi.
- **No interactive mid-run steering:** one-shot child execution; parent cannot interactively steer the child mid-task (RPC mode could enable richer control but was not chosen).

## Notes and follow-ups

- Keep `config/agents-generated.json` in sync with ECC by rerunning `npm run build` after updating `./ecc` or changing the subset.
- For cheaper/faster delegations (e.g. `build-error-resolver`), pin a lightweight model in `config/agents-models.json`.
- If stricter isolation is needed, consider adding an explicit child working directory policy and/or additional CLI flags once confirmed in Pi docs; if richer control is needed, evaluate an RPC-based runner. Avoid running ECC `.pi` adapters/extensions in child sessions that could duplicate behavior unless intentional.
