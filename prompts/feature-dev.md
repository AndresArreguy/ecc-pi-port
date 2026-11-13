---
description: Guided feature development with codebase understanding and architecture focus
---
<!--
Pi prompt template generated from ECC command
Source: ecc/commands/feature-dev.md
SDD role: implement
Status: partial
Blocked reason: Original multi-agent orchestration (code-explorer/code-architect/code-reviewer) runs inline or via run_agent; no automatic 3-agent pipeline.
Unblocks at: Future: automatic delegation pipeline (optional).
Dependencies: subagents, run_agent
Adaptations:
- Converted agent-delegation phases to inline guidance using Pi tools (read/grep/find/bash/edit/write) so it can be followed without subagents.
- Marked original multi-agent orchestration as degraded/blocked until delegation support is added.
- Removed Task-tool-specific instructions.
- Converted subagent-driven phases (code-explorer/code-architect/code-reviewer) to inline Pi tool-driven steps.
-->

> **Pi port status:** degradado respecto del flujo multi-agente original (subagentes/Task tool). Ejecuta inline con las herramientas de Pi hasta que se use `run_agent` o delegación externa.

A structured feature-development workflow that emphasizes understanding existing code before writing new code.

## Phases

### 1. Discovery

- read the feature request carefully
- identify requirements, constraints, and acceptance criteria
- ask clarifying questions if the request is ambiguous

### 2. Codebase Exploration

- explore the relevant existing code directly (use read/grep/find/bash) to trace execution paths, architecture, and integration points
- trace execution paths and architecture layers
- understand integration points and conventions

### 3. Clarifying Questions

- present findings from exploration
- ask targeted design and edge-case questions
- wait for user response before proceeding

### 4. Architecture Design

- design the feature architecture inline (or delegate only if a Pi-compatible subagent mechanism is available)
- provide the implementation blueprint
- wait for approval before implementing

### 5. Implementation

- implement the feature following the approved design
- prefer TDD where appropriate
- keep commits small and focused

### 6. Quality Review

- review the implementation inline (and/or use the `code-review` prompt template / review skills)
- address critical and important issues
- verify test coverage

### 7. Summary

- summarize what was built
- list follow-up items or limitations
- provide testing instructions
