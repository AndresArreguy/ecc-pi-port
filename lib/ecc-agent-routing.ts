/**
 * Intent → agent routing for this port.
 *
 * Single source of truth for "when should the main session delegate, and to
 * whom". It is rendered into the `run_agent` prompt guidelines so the routing
 * travels with the tool (and survives compaction) instead of depending on the
 * model remembering the AGENTS.md table.
 *
 * Keep it small: every line here costs prompt space on every turn.
 */

export interface AgentRoute {
  /** Stable id, also used by tests. */
  id: string;
  /** Natural-language cues, lowercase, Spanish and English. */
  triggers: string[];
  /** Agents in execution order. Must exist in config/agents-generated.json. */
  agents: string[];
  /** What the delegation actually buys, in one line. */
  note: string;
}

export const AGENT_ROUTES: AgentRoute[] = [
  {
    id: "plan",
    triggers: ["hagamos un plan", "planificá", "cómo lo encaramos", "plan this", "make a plan"],
    agents: ["planner"],
    note: "read-only: returns the plan, touches no files",
  },
  {
    id: "feature",
    triggers: ["vamos a encarar esta feature", "implementá", "agregá soporte", "build this feature"],
    agents: ["code-explorer", "architect", "tdd-guide", "code-reviewer"],
    note: "architect only when a schema/contract/architecture call is needed",
  },
  {
    id: "bug",
    triggers: ["arreglá el bug", "por qué falla", "fix this bug", "reproduce"],
    agents: ["tdd-guide"],
    note: "failing test that reproduces first, then the fix",
  },
  {
    id: "build",
    triggers: ["arreglá el build", "typecheck roto", "build is broken", "no compila"],
    agents: ["build-error-resolver"],
    note: "it runs the compiler/tests itself",
  },
  {
    id: "review",
    triggers: ["revisá esto", "review this", "después de escribir código"],
    agents: ["code-reviewer", "react-reviewer", "typescript-reviewer"],
    note: "the stack reviewer replaces code-reviewer when the diff is single-stack, not both in parallel",
  },
  {
    id: "security",
    triggers: ["auth", "permisos", "secretos", "migración", "input de usuario"],
    agents: ["security-reviewer"],
    note: "adds to review, never replaces it",
  },
  {
    id: "cleanup",
    triggers: ["limpiá", "simplificá", "refactorizá", "reduce duplication"],
    agents: ["code-simplifier", "refactor-cleaner", "code-reviewer"],
    note: "simplifier changes behavior-preserving code; cleaner hunts duplication/dead code",
  },
  {
    id: "performance",
    triggers: ["está lento", "optimizá", "performance", "core web vitals"],
    agents: ["performance-optimizer"],
    note: "measure before/after, no speculative micro-optimizations",
  },
  {
    id: "a11y",
    triggers: ["accesibilidad", "a11y", "screen reader", "teclado"],
    agents: ["a11y-architect"],
    note: "audits semantics, focus and contrast",
  },
  {
    id: "tests",
    triggers: ["faltan tests", "cobertura", "write tests", "test coverage"],
    agents: ["pr-test-analyzer", "tdd-guide"],
    note: "analyzer finds gaps, tdd-guide writes them",
  },
  {
    id: "docs",
    triggers: ["actualizá la doc", "readme", "docs del proyecto"],
    agents: ["doc-updater"],
    note: "documents in the place the project already uses",
  },
  {
    id: "ship",
    triggers: ["está listo para prod", "ship it", "auditá el repo", "pre-launch"],
    agents: ["security-reviewer", "code-reviewer"],
    note: "plus the project gate; the agents do not run your gate",
  },
];

/**
 * Rules that make delegation safe, rendered with the routes. These are the
 * failure modes that actually bite: delegating one-liners, two agents on the
 * same file, and reporting "done" without the project's own gate.
 */
export const DELEGATION_RULES: string[] = [
  "Delegate when the intent matches a route above; a one-line change or typo stays inline.",
  "Read-only routes (planner, architects, reviewers, analyzers) can run in parallel; two agents never write the same file at once.",
  "Every brief carries exact file paths and the done criterion: children start with no context and return text, not diffs.",
  "The child does not know the project gate: run it yourself before reporting anything as done.",
];

/** Compact prompt block: one line per route, agents in execution order. */
export function renderRoutingGuidance(): string[] {
  const lines = [
    "Delegation routing (match the user's intent, do not wait to be told the agent name):",
  ];
  for (const route of AGENT_ROUTES) {
    const cue = route.triggers.slice(0, 3).join(" / ");
    lines.push(`- ${cue} → ${route.agents.join(" → ")} (${route.note})`);
  }
  lines.push(...DELEGATION_RULES.map((rule) => `- ${rule}`));
  return lines;
}

/** Agent names referenced by the routes, deduplicated. */
export function routedAgentNames(): string[] {
  return [...new Set(AGENT_ROUTES.flatMap((route) => route.agents))];
}
