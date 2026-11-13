# ECC for Pi

**English** · [Español](README.es.md)

Bring the portable engineering core of [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC)
to [Pi](https://pi.dev): curated skills, prompt commands, coding rules, an ECC
hooks adapter, an isolated agent runner and a spec-driven flow — packaged as a
real Pi package.

[![CI](https://github.com/andresarreguy/ecc-pi-port/actions/workflows/ci.yml/badge.svg)](https://github.com/andresarreguy/ecc-pi-port/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ecc-pi-port?logo=npm)](https://www.npmjs.com/package/ecc-pi-port)
[![npm downloads](https://img.shields.io/npm/dm/ecc-pi-port)](https://www.npmjs.com/package/ecc-pi-port)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-8A2BE2)](https://pi.dev/packages)
[![ECC](https://img.shields.io/badge/ECC-v2.2.3-orange)](https://github.com/affaan-m/ECC)
[![Stars](https://img.shields.io/github/stars/andresarreguy/ecc-pi-port?style=social)](https://github.com/andresarreguy/ecc-pi-port)

- **ECC source:** [`affaan-m/ECC`](https://github.com/affaan-m/ECC) v2.2.3 (MIT, © 2026 Affaan Mustafa).
- **This port:** adapters, generators, packaging and docs (MIT, © 2026 BaráDev).
- Generated `skills/`, `prompts/` and `rules/` are curated ECC content under the
  same MIT license. See [`LICENSE`](LICENSE).

> Status and roadmap: [`docs/pi-port/STATUS.md`](docs/pi-port/STATUS.md).
> Security checklist: [`SECURITY.md`](SECURITY.md).
> Base release notes: [`docs/pi-port/06-release.md`](docs/pi-port/06-release.md).

## Is this really a Pi package?

Yes. `package.json` declares a `pi` manifest (`extensions`, `skills`, `prompts`),
the `pi-package` keyword and Pi peer dependencies. Once published, it is
installable with `pi install npm:ecc-pi-port` and eligible for the
[Pi package gallery](https://pi.dev/packages).

## Requirements

- Pi `1.5.x` or newer.
- Node.js `>= 22.6` to build/test the package from source (Pi loads the
  TypeScript extensions through its own runtime).
- `git` + network access for `npm run setup` / `npm run update-ecc`
  (ECC is cloned from GitHub and pinned by `ecc.lock`).

## Install

### From npm (recommended)

```bash
pi install npm:ecc-pi-port
```

It adds the package to `~/.pi/agent/settings.json`. Use `-l` from a project root
to write `.pi/settings.json` instead.

### From source

```bash
git clone https://github.com/andresarreguy/ecc-pi-port.git
cd ecc-pi-port

# one command: installs dev deps, clones ECC at the locked commit,
# rebuilds every artifact and runs the smoke tests
npm run setup

pi install .
```

`npm run setup` is idempotent: it reuses an existing `./ecc` checkout, verifies
it matches `ecc.lock`, fetches tags and rebuilds. Useful flags:

```bash
npm run setup -- --skip-tests
npm run setup -- --skip-install
npm run setup -- --ecc-ref v2.2.3   # first bootstrap without ecc.lock
```

Try it without installing:

```bash
pi -e .
```

### First checks inside Pi

```text
/ecc-rules            # list/inject ECC coding rules by stack
/plan-prd             # spec/PRD prompt template
/plan                 # implementation plan
/sdd-spec <feature>   # spec-driven flow
```

## What's included

| Resource | Count | Notes |
|---|---|---|
| Skills | 123 | Curated with ECC's own `pi-core.json` manifest (languages, testing, review, security, planning, docs, git/PR). `council` ships as `ecc-council`. |
| Prompt commands | 7 | `/plan-prd`, `/plan`, `/prp-implement`, `/feature-dev`, `/code-review`, `/test-coverage`, `/quality-gate`. |
| Rules | 22 stacks · 121 files | `common` + TypeScript, React, Python, Go, Rust, Java, Kotlin, PHP, Ruby, Swift, C#, C++, Dart, Vue, Nuxt, Angular, Perl, F#, ArkTS, Web, React Native. |
| Extensions | 4 | `ecc-hooks`, `ecc-rules`, `ecc-agents`, `ecc-sdd`. |
| Agents | 6 | `planner`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `tdd-guide`, `architect` via the `run_agent` tool. |
| Hooks | 5 on / 4 optional | `session:start`, `session:end:marker`, `pre:bash:dispatcher`, `post:quality-gate`, `stop:format-typecheck`. |
| SDD flow | 6 commands | `/sdd-model`, `/sdd-spec`, `/sdd-plan`, `/sdd-implement`, `/sdd-review`, `/sdd-verify`. |

### Commands

```text
/plan-prd        lean PRD / spec
/plan            implementation plan (waits for confirmation)
/prp-implement   execute a plan with validation loops
/feature-dev     end-to-end feature (inline or via run_agent)
/code-review     local review; PR mode needs gh + network
/test-coverage   coverage analysis and gap filling
/quality-gate    formatter gate (hook or inline fallback)
```

Templates keep ECC's `.claude/` artifact paths for compatibility.

### Hooks

| Hook | Pi event | What it does |
|---|---|---|
| `session:start` | `session_start` | Loads ECC context and injects `additionalContext` into the system prompt. |
| `session:end:marker` | `session_shutdown` | Session/observer lease cleanup. |
| `pre:bash:dispatcher` | `tool_call` (bash) | Blocks dangerous commands with exit code 2. |
| `post:quality-gate` | `tool_result` (edit/write) | Runs the project formatter on the edited file. |
| `stop:format-typecheck` | `agent_end` | Batch-format edited files and `tsc --noEmit` when a `tsconfig.json` exists. |

Optional (off by default): `pre:compact`, `stop:session-end`,
`pre:write:doc-file-warning`, `pre:config-protection`.

### Rules

Pi has no native rules resource, so `ecc-rules` injects `rules/<stack>/*.md` into
the system prompt:

```bash
ECC_PI_RULES=auto pi          # detect from project markers
ECC_PI_RULES=typescript,react pi
ECC_PI_RULES=off pi
```

```text
/ecc-rules                    # list stacks + current selection
/ecc-rules auto
/ecc-rules typescript python
/ecc-rules off
```

`common` is always included. `ECC_PI_RULES_MAX_CHARS` caps injected content
(default 60000).

### Agents

`run_agent` runs an ECC agent in an isolated child `pi` process (`--mode json`,
`--no-session`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`,
`--no-themes`) and returns only the final result. Limits live in
`config/agents-models.json` (`maxTurns`, `timeoutMs`, `maxParallel`, optional
provider/model/thinking per agent).

### SDD flow

`config/sdd-models.json` selects provider/model/thinking per phase
(`spec`, `plan`, `implement`, `review`, `verify`, `light`). Artifacts are written
to `specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`, `review.md`,
`verify.md`, `costs.md`).

## What's NOT included

- Not all of ECC: 123/293 skills and 7/94 commands. Curation excludes SaaS
  integrations, Claude-Code-only hooks, domain packs and `Task`-dependent flows.
- No native subagents: `run_agent` uses a child process, not Claude's `Task`.
- Hooks are not 1:1. `Stop` maps to `agent_end` + `session_shutdown`; the
  `transcript_path` is not a Claude JSONL transcript.
- No themes, MCP servers or model providers — use Pi's configuration.
- No formatters/linters or `gh` are bundled. Hooks may call `npx`/package
  managers (and therefore the network) when the project lacks a formatter.
- No end-to-end LLM tests in CI; the suite covers generators, payloads, gating
  and extension registration without an LLM.

## Build and test

```bash
npm run setup          # bootstrap (clone ECC, install, build, test)
npm run build          # regenerate skills/, rules/, prompts/, agent data
npm run build:check    # fail if generated artifacts are stale
npm test               # 31 smoke tests, no LLM
npm run verify         # build:check + tests
npm run verify:install # RPC check against an installed package
npm run release:check  # metadata + tarball checks
npm run pack:dry       # inspect the npm tarball
```

Pipeline:

```text
ecc/manifests/pi-core.json ──► skills/            (123 skills, curated)
ecc/rules/**               ──► rules/             (+ index)
ecc/commands/*.md          ──► prompts/           (config/commands-allowlist.json)
ecc/agents/*.md            ──► config/agents-generated.json
ecc/VERSION + ecc.lock     ──► sourceVersion/sourceRef stamps
```

`./ecc` is **not committed**: it is a git checkout created by `npm run setup` and
pinned by `ecc.lock` (repo, tag, commit, version). `npm run build` never modifies
`./ecc`. If ECC adds a skill that is not classified in its curation manifest, the
build fails on purpose.

## Updating ECC

```bash
# analyze only (writes a report, changes nothing)
npm run update-ecc -- v2.2.4 --dry-run

# apply
npm run update-ecc -- v2.2.4

# a commit works too
npm run update-ecc -- a1b2c3d
```

The updater:

1. Verifies `./ecc` is clean and its HEAD matches `ecc.lock`.
2. Converts shallow clones (`git fetch --unshallow --tags`) and fetches tags.
3. Shows the commit range filtered to `skills/`, `agents/`, `commands/`,
   `hooks/`, `rules/` and `scripts/`.
4. Checks out the requested ref.
5. Rebuilds **all** artifacts (skills, rules, prompts, agents, generated docs),
   applying `overlays/`.
6. Runs `npm test`. On build/test failure it restores the previous ECC commit,
   the generated artifacts and the lock — the repo is never left half-updated.
7. Writes `docs/pi-port/update-<date>.md` with allowlist removals/renames, new
   unclassified skills, command changes, `hooks.json` changes, hook script
   changes, input/output contract risk, build/test results and rollback status.
8. Updates `ecc.lock` only on success.
9. Prints a short summary and asks for confirmation. **It never commits.**

### Reviewing hook changes

- **High risk 🔴:** `hookSpecificOutput`, `additionalContext`,
  `permissionDecision`, exit code `2` (blocking), or a script used by
  `lib/ecc-hooks-core.ts` changed. Review the diff and the adapter tests; update
  `lib/ecc-hooks-core.ts` before committing if the contract changed.
- **Medium risk 🟡:** `tool_input`/`tool_output`/`tool_response`,
  `hook_event_name`, stdin/stdout or the runtime (`run-with-flags.js`,
  `hook-input.js`, `hook-flags.js`) changed. Confirm payload mapping still works
  and `pre:bash:dispatcher` still blocks `--no-verify`.
- **Scripts added/removed:** a missing adapter script is reported as absent;
  update `HOOK_SPECS` or disable that hook.
- After any update: `npm run verify:install` (skills, commands, session hook,
  `run_agent`).

### Overlays

Keep local edits to a curated skill in `overlays/skills/<ecc-skill-name>/`. The
build uses the overlay instead of the ECC copy; the updater warns when the ECC
base changed or disappeared. See [`overlays/README.md`](overlays/README.md).

## Disable hooks

```bash
export ECC_HOOKS_ENABLED=false          # all ECC hooks
export ECC_HOOK_PROFILE=minimal         # minimal | standard | strict
export ECC_DISABLED_HOOKS=post:quality-gate,stop:format-typecheck
export ECC_PI_RULES=off                 # only rules
```

PowerShell: `$env:ECC_HOOKS_ENABLED = "false"`.

## Security

Extensions run with your full user permissions; hooks execute Node code from ECC
and can spawn formatters/`npx`; `run_agent` inherits the environment and is not
sandboxed. Read [`SECURITY.md`](SECURITY.md) before installing on another
machine, and keep `LICENSE` (port + ECC MIT notices).

## Publishing (maintainers)

`prepublishOnly` runs `npm run verify` + `npm run release:check`, and `prepack`
runs `build:check`. To publish:

```bash
npm version patch|minor|major
npm publish --access public
```

The GitHub release workflow publishes on `v*` tags using `NPM_TOKEN`. The
published tarball includes the generated artifacts plus `ecc/scripts/` and
`ecc/hooks/` (the hook runtime) but **not** `ecc/.git`, `node_modules` or
`.pi-port`.

## Repo layout

```text
ecc-pi-port/
├── package.json          # Pi manifest + npm metadata
├── ecc.lock              # pinned ECC repo/tag/commit/version
├── extensions/           # ecc-hooks, ecc-rules, ecc-agents, ecc-sdd
├── lib/                  # pure, testable adapter logic
├── skills/ prompts/ rules/   # generated (not edited by hand)
├── config/               # allowlists, agent/SDD model config, generated agent data
├── ecc/                  # git checkout (gitignored, created by setup)
├── overlays/             # local skill overrides
├── scripts/              # setup, build, update-ecc, release-check
├── tests/pi-port/        # node:test suite + install verification
└── docs/pi-port/         # recon, commands, hooks, agents, SDD, status, update reports
```

## Troubleshooting

- **Skills not showing:** check `pi list` and `~/.pi/agent/settings.json`. Remove
  `ecc/pi/core` if installed — it collides with this package's skill names.
- **Hooks not running:** read `.pi-port/logs/ecc-hooks.log` in the cwd and check
  `ECC_HOOKS_ENABLED`. If it says “ECC root not found”, set
  `ECC_HOOKS_ECC_ROOT=/path/to/ecc-pi-port/ecc`.
- **Formatter/typecheck slow or hitting the network:** disable
  `post:quality-gate` and `stop:format-typecheck`, or install the formatter and
  `typescript` in the project.
- **`/ecc-rules` injects nothing:** the stack does not exist or `auto` found no
  markers; try `/ecc-rules typescript`.
- **`npm run setup` cannot clone ECC:** check git/network, or clone manually to
  `./ecc` and re-run. Offline with an existing checkout: `npm run setup -- --no-fetch`.
- **`ecc HEAD != ecc.lock`:** run `npm run update-ecc -- <ref>` or restore the
  pinned commit; the build refuses to silently mix versions.

## License

MIT. See [`LICENSE`](LICENSE):

- Port: © 2026 BaráDev.
- ECC: © 2026 Affaan Mustafa — <https://github.com/affaan-m/ECC> (MIT).
- `skills/`, `prompts/` and `rules/` are derived from ECC.

---

## ⭐ If this saved you time

Give the repo a star — it helps other Pi users find the port and keeps the
updater/curation work going. Issues and PRs are welcome.

[![Star this repo](https://img.shields.io/github/stars/andresarreguy/ecc-pi-port?style=social)](https://github.com/andresarreguy/ecc-pi-port)
