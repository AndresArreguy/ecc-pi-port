---
description: Run the ECC formatter quality gate for a single file and report remediation steps.
---
<!--
Pi prompt template generated from ECC command
Source: ecc/commands/quality-gate.md
SDD role: quality-gate
Status: partial
Blocked reason: Original command wrapped the ECC hook runtime; the hooks adapter now runs the gate on edit/write and the template keeps an inline fallback.
Dependencies: hooks, run_agent
Adaptations:
- Converted to a Pi prompt template that explains the limitation and provides inline formatter-check alternatives (Biome/Prettier/gofmt/ruff) via bash when available.
- Documented the hook adapter path and kept inline formatter-check fallback.
- Failures bigger than formatting delegate to `build-error-resolver` through `run_agent`.
-->

> **Pi port status:** el adaptador de hooks (`extensions/ecc-hooks.ts`) ejecuta el quality gate de ECC en `tool_result` para `edit`/`write` cuando el hook está habilitado. Esta plantilla mantiene la alternativa inline como fallback.

## Pi-adapted usage (inline formatter checks)

The ECC `quality-gate` hook formats/checks one file by type. If the hook adapter is disabled, run the underlying formatter directly on the target file (`$ARGUMENTS` or chosen path):

```bash
# JS/TS/JSON/MD (project-dependent): prefer Biome or Prettier if configured
npx --no-install biome check "<path>" || npx --no-install prettier --check "<path>"

# Go
gofmt -l "<path>"

# Python
ruff format --check "<path>"
```

To apply fixes (equivalent intent to `ECC_QUALITY_GATE_FIX=true`), use formatter write modes supported by the project (e.g. `prettier --write`, `ruff format <path>`, `gofmt -w <path>`). Lint/type/test verification is out of scope for this gate; use `test-coverage`, `code-review`, or the `verification-loop` skill as appropriate.

If the gate keeps failing on something bigger than formatting (type errors, broken build, failing suite), delegate to `build-error-resolver` with `run_agent` and the failing command output in the brief.

---

## Original ECC command (reference, hook-dependent)

# Quality Gate Command

Operator entry point for the formatter quality gate that normally runs as the
`post:quality-gate` PostToolUse hook (`scripts/hooks/quality-gate.js`).

## How it actually works

The gate is a single-file formatter check driven by hook input, not CLI flags:

- The script reads the target from the hook's stdin JSON
  (`tool_input.file_path`); it does not take a path argument.
- Behavior toggles are environment variables:
  - `ECC_QUALITY_GATE_FIX=true` - apply formatting fixes instead of check-only
  - `ECC_QUALITY_GATE_STRICT=true` - log formatter failures as gate failures
- Coverage by file type:
  - `.ts/.tsx/.js/.jsx/.json/.md` - Biome `check` or Prettier `--check`,
    whichever the project ships (JS/TS under Biome is skipped here because
    `post-edit-format` already runs `biome check --write`)
  - `.go` - `gofmt`
  - `.py` - `ruff format`
- Lint and type checks are not part of this gate. Use the `verification-loop`
  skill or the language verification skills for lint/type/test pipelines.

## Usage

To run the gate manually against one file, pipe hook-style JSON into the
script (set the env toggles first if you want fix or strict behavior):

```bash
echo '{"tool_input":{"file_path":"src/example.ts"}}' \
  | ECC_QUALITY_GATE_FIX=true node scripts/hooks/quality-gate.js
```

Then report formatter findings and concrete remediation steps.

## Notes

Hook wiring enters through the async PostToolUse dispatcher in
`hooks/hooks.json`. Its internal registry preserves the `post:quality-gate`
ID and the `standard`/`strict` profiles.

## Arguments

$ARGUMENTS:

- `[path]` optional file to check. The script itself takes no CLI
  arguments - when a path is given, substitute it as `tool_input.file_path`
  in the stdin JSON shown above before running the command
