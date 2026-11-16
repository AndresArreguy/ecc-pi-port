# Contributing to ecc-pi-port

Thanks for taking the time to contribute. Issues and pull requests can be written
in English or Spanish.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security reports must follow [SECURITY.md](SECURITY.md).

## What belongs here

This repository is the **Pi port** of [ECC](https://github.com/affaan-m/ECC): the
adapters, generators, packaging, docs, tests and updater that make ECC work as a
Pi package.

- Improvements to the port (extensions, generators, hooks adapter, agents
  runner, SDD flow, packaging, docs, tests) belong here.
- Changes to ECC's own skills, commands, rules or hooks belong upstream in
  [affaan-m/ECC](https://github.com/affaan-m/ECC), unless they are Pi-specific
  adaptations handled through `overlays/` or this repo's scripts.
- Do not edit the generated `skills/`, `prompts/` or `rules/` trees by hand.
  They are rebuilt from `./ecc` plus `overlays/`.

## Before you start

- For anything non-trivial, open an issue first so we can agree on scope.
- Keep one PR focused on one change.
- Check existing issues and PRs before opening a new one.
- Do not open a public issue for a security vulnerability.

## Repository layout

| Path | Purpose |
|---|---|
| `extensions/` | Pi extensions: hooks adapter, rules, agents runner, SDD flow. |
| `lib/` | Pure helpers with tests (hooks core, rules core, SDD config/i18n). |
| `tests/pi-port/` | Smoke and integration tests without an LLM. |
| `scripts/` | Setup, build, generators, updater, release checks. |
| `config/` | Allowlists, agents subset, model configs. |
| `skills/`, `prompts/`, `rules/` | **Generated** from `./ecc` + `overlays/`. Do not edit by hand. |
| `overlays/` | Intentional overrides for ECC skills. |
| `ecc/` | Local clone of ECC, pinned by `ecc.lock`. Gitignored. |
| `ecc.lock` | Repo, ref, commit and ECC version used by the build. |

## Setup

Requirements: Node.js **22.6+**, git and network access for the first setup.

```bash
git clone https://github.com/AndresArreguy/ecc-pi-port.git
cd ecc-pi-port
npm run setup
```

`npm run setup` installs dependencies, clones ECC at the `ecc.lock` commit,
builds all generated artifacts and runs the tests. It is idempotent and supports:

```text
--skip-install  --skip-tests  --no-fetch  --force  --ecc-ref <ref>
```

## Development loop

```bash
npm run build          # regenerate skills, prompts, rules, agents
npm run build:check    # detect drift in generated artifacts
npm test               # smoke/integration tests, no LLM
npm run verify         # build:check + tests
npm run release:check  # package metadata + tarball contents
```

Before opening a PR, run at least:

```bash
npm run verify
```

If your change touches packaging, metadata, `ecc.lock` or the updater, also run:

```bash
npm run release:check
```

## Updating ECC

```bash
npm run update-ecc -- <tag-or-commit> [--dry-run] [--no-fetch] [--skip-tests]
```

The updater converts shallow clones, resolves the ref, rebuilds every artifact,
runs tests, rolls back on failure and writes a report under
`docs/pi-port/update-<date>.md`. Never commit `./ecc`; reproducibility comes from
`ecc.lock` plus the local clone.

## Generated files and overlays

- Change generators in `scripts/` or content under `./ecc`, then run
  `npm run build`.
- Keep Pi-specific skill changes in `overlays/skills/<skill>/`. The updater warns
  when the upstream skill changes or disappears.
- Command allowlists live in `config/commands-allowlist.json`; the agent subset
  lives in `config/agents-subset.json`.
- `core.hooksPath` is not used by this repo. Hooks are bridged by
  `extensions/ecc-hooks.ts` and `lib/ecc-hooks-core.ts`.

## Code guidelines

- TypeScript, ESM, Node 22.6+.
- Keep `@earendil-works/*` and `typebox` as peer dependencies; do not add them to
  `dependencies`.
- Add tests for pure logic in `lib/` or generators/hooks behavior. Tests must not
  require network or an LLM.
- Keep the hooks contract compatible with ECC's payloads; update
  `docs/pi-port/03-hooks.md` when behavior changes.
- Do not invent Pi APIs. Check the installed Pi docs (`docs/extensions.md`,
  `docs/tui.md`, `docs/packages.md`) before using a new one.
- Do not commit secrets, sessions, logs, `node_modules`, `.pi-port/` or `./ecc`.
- Keep `CHANGELOG.md` entries accurate; maintainers decide the release version.

## Commits and pull requests

Use Conventional Commits:

```text
feat: ...
fix: ...
docs: ...
test: ...
chore: ...
ci: ...
```

A PR should include:

- What changed and why.
- Which layer is affected (extension, lib, generator, hooks, agents, SDD, docs).
- How you tested it (`npm run verify`, `release:check`, manual Pi run, OS).
- A note if generated artifacts changed and were rebuilt with `npm run build`.
- Any follow-up work or known limitations.

Checklist:

- [ ] `npm run verify` passes.
- [ ] Generated artifacts are rebuilt (`npm run build`), not hand-edited.
- [ ] `./ecc` is not committed.
- [ ] Docs updated when behavior or config changes.
- [ ] `release:check` passes if packaging/metadata changed.
- [ ] No secrets, logs, sessions or `node_modules` in the diff.

## License and attribution

By contributing, you agree that your contributions are licensed under the MIT
license of this repository. ECC content remains © Affaan Mustafa under MIT; see
[LICENSE](LICENSE) and `ecc/LICENSE`.
