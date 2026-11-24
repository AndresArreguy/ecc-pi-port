---
description: Guided feature development with codebase understanding and architecture focus
---
<!--
Pi prompt template generated from ECC command
Source: ecc/commands/feature-dev.md
SDD role: implement
Status: ready
Dependencies: run_agent
Adaptations:
- Restored the multi-agent pipeline through `run_agent`: code-explorer → architect (only for schema/contract calls) → tdd-guide (tests first) → code-reviewer + stack reviewer.
- The main session orchestrates: it writes the briefs, serializes writes per file, consolidates findings and runs the project gate itself.
- Adds `security-reviewer` when the change touches auth, permissions, user input or secrets.
-->

> **Pi port status:** el pipeline multi-agente corre con `run_agent` (subagentes aislados). El orquestador es el chat principal: delega, consolida y corre el gate del proyecto en `bash`. Agregá `security-reviewer` cuando el cambio toque auth, permisos, inputs de usuario o secretos.

Implement the tasks with `tdd-guide` (tests first) and hand it one task per call, with the exact files and the done criterion. Serialize writes: two agents never touch the same file at once.

A structured feature-development workflow that emphasizes understanding existing code before writing new code.

## Phases

### 1. Discovery

- read the feature request carefully
- identify requirements, constraints, and acceptance criteria
- ask clarifying questions if the request is ambiguous

### 2. Codebase Exploration

- delegate to `code-explorer` with `run_agent` (read-only) to trace execution paths, architecture and integration points; it returns analysis, not diffs
- trace execution paths and architecture layers
- understand integration points and conventions

### 3. Clarifying Questions

- present findings from exploration
- ask targeted design and edge-case questions
- wait for user response before proceeding

### 4. Architecture Design

- delegate to `architect` with `run_agent` when the feature needs a schema, contract or architecture decision; skip it for straightforward changes
- provide the implementation blueprint
- wait for approval before implementing

### 5. Implementation

- implement the feature following the approved design
- prefer TDD where appropriate
- keep commits small and focused

### 6. Quality Review

- delegate to `code-reviewer` (plus the stack reviewer: `react-reviewer`, `typescript-reviewer`, …) once the implementation is green
- address critical and important issues
- verify test coverage

### 7. Summary

- summarize what was built
- list follow-up items or limitations
- provide testing instructions
