import type { EccLock } from "./ecc-lock.ts";
import type { NameStatus } from "./ecc-git.ts";

export interface ManifestInfo {
  include: string[];
  exclude: Record<string, string>;
  rename: Record<string, string>;
}

export interface SkillAnalysis {
  removedFromAllowlist: string[];
  addedToAllowlist: string[];
  renamed: Array<{ from: string; to: string }>;
  missingOnDisk: string[];
  unclassifiedNew: string[];
  newExcluded: string[];
  newNotInAllowlist: string[];
  overlays: Array<{ name: string; baseChanged: boolean; baseMissing: boolean; changedFiles: string[] }>;
}

export function analyzeSkills(input: {
  oldDirs: string[];
  newDirs: string[];
  oldManifest: ManifestInfo | null;
  newManifest: ManifestInfo | null;
  overlays: string[];
  changedFiles: string[];
}): SkillAnalysis {
  const oldInclude = input.oldManifest?.include ?? [];
  const newInclude = input.newManifest?.include ?? [];
  const newExclude = input.newManifest?.exclude ?? {};
  const oldExclude = input.oldManifest?.exclude ?? {};
  const rename = input.newManifest?.rename ?? {};

  const oldDirSet = new Set(input.oldDirs);
  const newDirSet = new Set(input.newDirs);
  const oldIncludeSet = new Set(oldInclude);
  const newIncludeSet = new Set(newInclude);

  const renamed = Object.entries(rename)
    .filter(([from, to]) => input.oldManifest?.rename?.[from] !== to || !oldIncludeSet.has(from))
    .map(([from, to]) => ({ from, to }));

  const renameSources = new Set(Object.keys(rename));
  const removedFromAllowlist = oldInclude.filter((name) => !newIncludeSet.has(name) && !renameSources.has(name));
  const renamedTargets = new Set(renamed.map((entry) => entry.to));
  const addedToAllowlist = newInclude.filter((name) => !oldIncludeSet.has(name) && !renamedTargets.has(name));
  const missingOnDisk = newInclude.filter((name) => !newDirSet.has(name));
  const unclassifiedNew = input.newDirs.filter(
    (name) => !newIncludeSet.has(name) && !(name in newExclude),
  );
  const newExcluded = input.newDirs.filter(
    (name) => !oldDirSet.has(name) && !newIncludeSet.has(name) && name in newExclude,
  );
  const newNotInAllowlist = input.newDirs.filter(
    (name) => !oldDirSet.has(name) && !newIncludeSet.has(name),
  );

  const overlays = input.overlays.map((name) => {
    const prefix = `skills/${name}/`;
    const changedFiles = input.changedFiles.filter((file) => file.startsWith(prefix));
    return {
      name,
      baseChanged: changedFiles.length > 0,
      baseMissing: oldDirSet.has(name) && !newDirSet.has(name),
      changedFiles,
    };
  });

  // Keep oldExclude referenced for future reporting (excluded skills that disappear are not interesting).
  void oldExclude;
  return {
    removedFromAllowlist,
    addedToAllowlist,
    renamed,
    missingOnDisk,
    unclassifiedNew,
    newExcluded,
    newNotInAllowlist,
    overlays,
  };
}

export interface CommandAnalysis {
  added: string[];
  removed: string[];
  addedNotInPort: string[];
  removedFromPort: string[];
  missingSources: string[];
}

export function analyzeCommands(input: {
  oldCommands: string[];
  newCommands: string[];
  portSources: string[];
}): CommandAnalysis {
  const oldSet = new Set(input.oldCommands);
  const newSet = new Set(input.newCommands);
  const portEntries = input.portSources.map((raw) => ({ raw, name: raw.replace(/\.md$/i, "") }));
  const portSet = new Set(portEntries.map((entry) => entry.name));
  const added = input.newCommands.filter((name) => !oldSet.has(name));
  const removed = input.oldCommands.filter((name) => !newSet.has(name));
  return {
    added,
    removed,
    addedNotInPort: added.filter((name) => !portSet.has(name)),
    removedFromPort: removed.filter((name) => portSet.has(name)),
    missingSources: portEntries.filter((entry) => !newSet.has(entry.name)).map((entry) => entry.raw),
  };
}

export interface HookEntry {
  event: string;
  matcher: string;
  hookId: string;
  script: string;
}

export function parseHooksJson(text: string | null): HookEntry[] | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const hooks = (parsed as { hooks?: Record<string, unknown> })?.hooks;
  if (!hooks || typeof hooks !== "object") return [];
  const out: HookEntry[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const matcher = String((entry as { matcher?: unknown })?.matcher ?? ".*");
      const calls = (entry as { hooks?: unknown[] })?.hooks ?? [];
      for (const call of calls) {
        const command = String((call as { command?: unknown })?.command ?? "");
        const match = command.match(/run-with-flags\.js\s+([^\s"']+)\s+(scripts\/[^\s"'\\]+)/);
        const scriptMatch = command.match(/(scripts\/hooks\/[A-Za-z0-9._-]+\.js)/);
        const script = match?.[2] ?? scriptMatch?.[1] ?? "";
        const hookId = match?.[1] ?? (script ? `${event}:${script}` : "");
        if (script) out.push({ event, matcher, hookId, script });
      }
    }
  }
  return out;
}

const CONTRACT_TOKENS: Array<{ name: string; re: RegExp; high: boolean }> = [
  { name: "hookSpecificOutput", re: /hookSpecificOutput/, high: true },
  { name: "additionalContext", re: /additionalContext/, high: true },
  { name: "permissionDecision", re: /permissionDecision/, high: true },
  { name: "exit code 2 (block)", re: /exitCode\s*=\s*2|process\.exit\(2\)|status\s*===\s*2/, high: true },
  { name: "tool_input/tool_output/tool_response", re: /\btool_(input|output|response)\b/, high: false },
  { name: "hook_event_name", re: /hook_event_name/, high: false },
  { name: "stdin/stdout contract", re: /process\.(stdin|stdout)|readStdin/, high: false },
];

export interface ContractFinding {
  file: string;
  tokens: string[];
  severity: "high" | "medium";
}

export interface HookAnalysis {
  added: HookEntry[];
  removed: HookEntry[];
  changed: Array<{ hookId: string; event: string; matcher: string; oldScript: string; newScript: string }>;
  changedScripts: string[];
  changedLibs: string[];
  newScripts: string[];
  removedScripts: string[];
  runtimeChanged: string[];
  contractFindings: ContractFinding[];
  adapterRisks: Array<{
    id: string;
    script: string;
    changed: boolean;
    missing: boolean;
    contractTokens: string[];
    severity: "high" | "medium" | "none";
  }>;
}

function contractTokensFor(diff: string): string[] {
  return CONTRACT_TOKENS.filter((token) => token.re.test(diff)).map((token) => token.name);
}

export function analyzeHooks(input: {
  oldHooksJson: string | null;
  newHooksJson: string | null;
  oldHookFiles: string[];
  newHookFiles: string[];
  changedFiles: NameStatus[];
  adapterSpecs: Array<{ id: string; script: string }>;
  diffs: Record<string, string>;
}): HookAnalysis {
  const oldEntries = parseHooksJson(input.oldHooksJson) ?? [];
  const newEntries = parseHooksJson(input.newHooksJson) ?? [];
  const keyOf = (entry: HookEntry) => `${entry.event}\u0000${entry.matcher}\u0000${entry.hookId}`;
  const oldMap = new Map(oldEntries.map((entry) => [keyOf(entry), entry]));
  const newMap = new Map(newEntries.map((entry) => [keyOf(entry), entry]));

  const added = newEntries.filter((entry) => !oldMap.has(keyOf(entry)));
  const removed = oldEntries.filter((entry) => !newMap.has(keyOf(entry)));
  const changed: HookAnalysis["changed"] = [];
  for (const [key, oldEntry] of oldMap) {
    const newEntry = newMap.get(key);
    if (newEntry && newEntry.script !== oldEntry.script) {
      changed.push({
        hookId: oldEntry.hookId,
        event: oldEntry.event,
        matcher: oldEntry.matcher,
        oldScript: oldEntry.script,
        newScript: newEntry.script,
      });
    }
  }

  const changedPaths = input.changedFiles.map((entry) => entry.path);
  const changedScripts = input.changedFiles
    .filter((entry) => /^scripts\/hooks\/[^/]+\.js$/.test(entry.path) && entry.status !== "D")
    .map((entry) => entry.path);
  const changedLibs = input.changedFiles
    .filter((entry) => /^scripts\/lib\/[^/]+\.js$/.test(entry.path) && entry.status !== "D")
    .map((entry) => entry.path);
  const oldHookSet = new Set(input.oldHookFiles);
  const newHookSet = new Set(input.newHookFiles);
  const newScripts = input.newHookFiles.filter((file) => !oldHookSet.has(file));
  const removedScripts = input.oldHookFiles.filter((file) => !newHookSet.has(file));

  const runtimeFiles = [
    "scripts/hooks/run-with-flags.js",
    "scripts/hooks/hook-input.js",
    "scripts/lib/hook-flags.js",
    "scripts/hooks/pretooluse-visible-output.js",
  ];
  const runtimeChanged = runtimeFiles.filter((file) => changedPaths.includes(file));

  const contractFindings: ContractFinding[] = [];
  for (const file of [...changedScripts, ...changedLibs, ...runtimeChanged]) {
    const tokens = contractTokensFor(input.diffs[file] ?? "");
    if (tokens.length === 0) continue;
    const high = CONTRACT_TOKENS.some((token) => token.high && tokens.includes(token.name));
    contractFindings.push({ file, tokens, severity: high ? "high" : "medium" });
  }

  const adapterRisks = input.adapterSpecs.map((spec) => {
    const missing = !newHookSet.has(spec.script);
    const changed = changedScripts.includes(spec.script);
    const tokens = contractTokensFor(input.diffs[spec.script] ?? "");
    const severity = missing ? "high" : tokens.some((token) => CONTRACT_TOKENS.find((t) => t.name === token)?.high) ? "high" : tokens.length > 0 ? "medium" : changed ? "medium" : "none";
    return { id: spec.id, script: spec.script, changed, missing, contractTokens: tokens, severity };
  });

  return {
    added,
    removed,
    changed,
    changedScripts,
    changedLibs,
    newScripts,
    removedScripts,
    runtimeChanged,
    contractFindings,
    adapterRisks,
  };
}

export interface UpdateReportData {
  command: string;
  status: "success" | "rolled-back" | "dry-run" | "no-op";
  oldLock: EccLock | null;
  targetLock: EccLock;
  oldCommit: string;
  targetCommit: string;
  commits: string[];
  changedFiles: NameStatus[];
  skills: SkillAnalysis;
  commands: CommandAnalysis;
  hooks: HookAnalysis;
  rulesChanged: NameStatus[];
  agentsChanged: NameStatus[];
  scriptsChanged: NameStatus[];
  build: {
    ok: boolean;
    summary?: string;
    error?: string;
    durationMs?: number;
    overlays?: Array<{ skill: string; target: string; path: string }>;
  };
  tests: { ran: boolean; ok: boolean; exitCode: number | null; tail: string };
  rollback: { attempted: boolean; ok: boolean; error?: string; restoredArtifacts: string[] };
  overlaysUsed: Array<{ skill: string; target: string; path: string }>;
  notes: string[];
}

function list(values: string[], empty = "Ninguno."): string {
  return values.length === 0 ? empty : values.map((value) => `- \`${value}\``).join("\n");
}

export function renderUpdateReport(data: UpdateReportData): string {
  const oldLabel = data.oldLock ? `${data.oldLock.ref} (${data.oldCommit.slice(0, 7)})` : data.oldCommit.slice(0, 7);
  const newLabel = `${data.targetLock.ref} (${data.targetCommit.slice(0, 7)})`;
  const statusLabel =
    data.status === "success"
      ? "✅ actualización aplicada"
      : data.status === "rolled-back"
        ? "⛔ rollback aplicado"
        : data.status === "dry-run"
          ? "🔎 dry-run (sin cambios)"
          : "➖ sin cambios";

  const lines: string[] = [];
  lines.push(`# Actualización ECC — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`- **Comando:** \`${data.command}\``);
  lines.push(`- **Estado:** ${statusLabel}`);
  lines.push(`- **ECC anterior:** ${oldLabel} · versión ${data.oldLock?.version ?? "?"}`);
  lines.push(`- **ECC nuevo:** ${newLabel} · versión ${data.targetLock.version}`);
  lines.push(`- **Lock:** \`ecc.lock\` ${data.status === "success" ? "actualizado" : data.status === "rolled-back" ? "restaurado" : "sin cambios"}`);
  lines.push("");

  lines.push("## 1. Commits en el rango (skills, agents, commands, hooks, rules, scripts)");
  lines.push("");
  if (data.commits.length === 0) lines.push("Sin commits en las rutas relevantes.");
  else {
    for (const commit of data.commits) lines.push(`- ${commit}`);
  }
  lines.push("");

  lines.push("## 2. Skills (allowlist / curación)");
  lines.push("");
  lines.push("### Desaparecidas o renombradas respecto de la curación");
  if (data.skills.removedFromAllowlist.length === 0 && data.skills.renamed.length === 0 && data.skills.missingOnDisk.length === 0) {
    lines.push("Sin desapariciones ni renombres.");
  } else {
    if (data.skills.removedFromAllowlist.length > 0) {
      lines.push("**Quitadas de la allowlist** (el build fallará si `pi-core.json` no se actualiza):");
      lines.push(list(data.skills.removedFromAllowlist));
    }
    if (data.skills.missingOnDisk.length > 0) {
      lines.push("");
      lines.push("**En la allowlist pero ausentes en disco** (el build falla):");
      lines.push(list(data.skills.missingOnDisk));
    }
    if (data.skills.renamed.length > 0) {
      lines.push("");
      lines.push("**Renombres mapeados en el manifest:**");
      for (const rename of data.skills.renamed) lines.push(`- \`${rename.from}\` → \`${rename.to}\``);
    }
  }
  lines.push("");
  lines.push("### Nuevas skills");
  if (data.skills.newNotInAllowlist.length === 0) {
    lines.push("Sin skills nuevas fuera de la allowlist.");
  } else {
    lines.push("**Nuevas que no estaban en la allowlist anterior:**");
    lines.push(list(data.skills.newNotInAllowlist));
    if (data.skills.addedToAllowlist.length > 0) {
      lines.push("");
      lines.push("**Ya incorporadas a la curación de ECC (se incluirán en el build):**");
      lines.push(list(data.skills.addedToAllowlist));
    }
    if (data.skills.newExcluded.length > 0) {
      lines.push("");
      lines.push("**Nuevas excluidas por la curación de ECC:**");
      lines.push(list(data.skills.newExcluded));
    }
    if (data.skills.unclassifiedNew.length > 0) {
      lines.push("");
      lines.push("**⚠️ Nuevas sin clasificar en `pi-core.json` (el build falla con curation drift):**");
      lines.push(list(data.skills.unclassifiedNew));
    }
  }
  lines.push("");
  lines.push("### Overlays");
  if (data.skills.overlays.length === 0) lines.push("No hay `overlays/skills/`.");
  else {
    for (const overlay of data.skills.overlays) {
      if (overlay.baseMissing) {
        lines.push(`- **\`${overlay.name}\`**: ⚠️ la skill base desapareció de ECC; revisá/eliminá el overlay.`);
      } else if (overlay.baseChanged) {
        lines.push(
          `- **\`${overlay.name}\`**: ⚠️ la skill base cambió en ECC (${overlay.changedFiles.length} archivo(s)). Revisá el overlay para re-aplicar tus cambios.`,
        );
      } else {
        lines.push(`- \`${overlay.name}\`: sin cambios en la base de ECC.`);
      }
    }
  }
  if (data.overlaysUsed.length > 0) {
    lines.push("");
    lines.push("Overlays usados en este build:");
    for (const overlay of data.overlaysUsed) lines.push(`- \`${overlay.path}\` → \`skills/${overlay.target}\``);
  }
  lines.push("");

  lines.push("## 3. Commands");
  lines.push("");
  if (data.commands.added.length === 0 && data.commands.removed.length === 0) {
    lines.push("Sin comandos nuevos ni eliminados en `ecc/commands/`.");
  } else {
    lines.push("**Nuevos en ECC:**");
    lines.push(list(data.commands.added));
    lines.push("");
    lines.push("**Eliminados en ECC:**");
    lines.push(list(data.commands.removed));
    if (data.commands.addedNotInPort.length > 0) {
      lines.push("");
      lines.push("**Nuevos no portados** (evaluar agregarlos a `config/commands-allowlist.json`):");
      lines.push(list(data.commands.addedNotInPort));
    }
    if (data.commands.removedFromPort.length > 0) {
      lines.push("");
      lines.push("**⚠️ Eliminados que estaban en el port** (el build falla si no se actualiza la allowlist):");
      lines.push(list(data.commands.removedFromPort));
    }
    if (data.commands.missingSources.length > 0) {
      lines.push("");
      lines.push("**⚠️ Fuentes de la allowlist ausentes** (el build falla):");
      lines.push(list(data.commands.missingSources));
    }
  }
  lines.push("");

  lines.push("## 4. Hooks");
  lines.push("");
  lines.push("### hooks.json");
  if (data.hooks.added.length === 0 && data.hooks.removed.length === 0 && data.hooks.changed.length === 0) {
    lines.push("Sin cambios en eventos/matchers/scripts de `ecc/hooks/hooks.json`.");
  } else {
    if (data.hooks.added.length > 0) {
      lines.push("**Agregados:**");
      for (const hook of data.hooks.added) lines.push(`- \`${hook.event}\` matcher \`${hook.matcher}\` → \`${hook.hookId}\` (\`${hook.script}\`)`);
    }
    if (data.hooks.removed.length > 0) {
      lines.push("");
      lines.push("**Eliminados:**");
      for (const hook of data.hooks.removed) lines.push(`- \`${hook.event}\` matcher \`${hook.matcher}\` → \`${hook.hookId}\` (\`${hook.script}\`)`);
    }
    if (data.hooks.changed.length > 0) {
      lines.push("");
      lines.push("**Script cambiado para el mismo hook:**");
      for (const hook of data.hooks.changed) lines.push(`- \`${hook.hookId}\`: \`${hook.oldScript}\` → \`${hook.newScript}\``);
    }
  }
  lines.push("");
  lines.push("### Scripts de hooks modificados");
  if (data.hooks.changedScripts.length === 0 && data.hooks.changedLibs.length === 0 && data.hooks.runtimeChanged.length === 0) {
    lines.push("Sin cambios en `scripts/hooks/` ni en las libs del runtime.");
  } else {
    if (data.hooks.changedScripts.length > 0) {
      lines.push("**`scripts/hooks/`:**");
      lines.push(list(data.hooks.changedScripts));
    }
    if (data.hooks.changedLibs.length > 0) {
      lines.push("");
      lines.push("**`scripts/lib/`:**");
      lines.push(list(data.hooks.changedLibs));
    }
    if (data.hooks.runtimeChanged.length > 0) {
      lines.push("");
      lines.push("**⚠️ Runtime del adaptador:**");
      lines.push(list(data.hooks.runtimeChanged));
    }
    if (data.hooks.newScripts.length > 0) {
      lines.push("");
      lines.push("**Nuevos:**");
      lines.push(list(data.hooks.newScripts));
    }
    if (data.hooks.removedScripts.length > 0) {
      lines.push("");
      lines.push("**Eliminados:**");
      lines.push(list(data.hooks.removedScripts));
    }
  }
  lines.push("");
  lines.push("### Formato de entrada/salida (heurística)");
  if (data.hooks.contractFindings.length === 0) {
    lines.push("No se detectaron tokens de contrato (`hookSpecificOutput`, `additionalContext`, `tool_input`, `exit 2`, etc.) en los diffs.");
  } else {
    lines.push("| Archivo | Severidad | Tokens detectados |");
    lines.push("|---|---|---|");
    for (const finding of data.hooks.contractFindings) {
      lines.push(`| \`${finding.file}\` | ${finding.severity === "high" ? "🔴 alta" : "🟡 media"} | ${finding.tokens.join(", ")} |`);
    }
    lines.push("");
    lines.push("> Revisá manualmente los scripts marcados antes de aceptar la actualización: el adaptador traduce payloads y depende de estas claves/exit codes.");
  }
  lines.push("");
  lines.push("### Impacto en el adaptador (`lib/ecc-hooks-core.ts`)");
  lines.push("");
  lines.push("| Hook | Script | Cambió | Ausente | Riesgo |");
  lines.push("|---|---|---|---|---|");
  for (const risk of data.hooks.adapterRisks) {
    const icon = risk.severity === "high" ? "🔴 alto" : risk.severity === "medium" ? "🟡 medio" : "—";
    lines.push(`| \`${risk.id}\` | \`${risk.script}\` | ${risk.changed ? "sí" : "no"} | ${risk.missing ? "sí" : "no"} | ${icon} |`);
  }
  lines.push("");

  lines.push("## 5. Rules / Agents / Scripts");
  lines.push("");
  lines.push("**Rules modificadas:**");
  lines.push(data.rulesChanged.length === 0 ? "Ninguna." : list(data.rulesChanged.map((entry) => `${entry.status} ${entry.path}`)));
  lines.push("");
  lines.push("**Agents modificados:**");
  lines.push(data.agentsChanged.length === 0 ? "Ninguno." : list(data.agentsChanged.map((entry) => `${entry.status} ${entry.path}`)));
  lines.push("");
  lines.push("**Otros scripts modificados:**");
  lines.push(data.scriptsChanged.length === 0 ? "Ninguno." : list(data.scriptsChanged.map((entry) => `${entry.status} ${entry.path}`)));
  lines.push("");

  lines.push("## 6. Build");
  lines.push("");
  lines.push(`- Resultado: ${data.build.ok ? "✅ OK" : "❌ FALLÓ"}`);
  if (data.build.durationMs != null) lines.push(`- Duración: ${data.build.durationMs} ms`);
  if (data.build.summary) {
    lines.push("");
    lines.push("```text");
    lines.push(data.build.summary.trim());
    lines.push("```");
  }
  if (data.build.error) {
    lines.push("");
    lines.push("```text");
    lines.push(data.build.error.trim());
    lines.push("```");
  }
  lines.push("");

  lines.push("## 7. Tests");
  lines.push("");
  if (!data.tests.ran) {
    lines.push("No se ejecutaron tests (`--skip-tests`).");
  } else {
    lines.push(`- Resultado: ${data.tests.ok ? "✅ OK" : "❌ FALLARON"} (exit ${data.tests.exitCode})`);
    if (data.tests.tail) {
      lines.push("");
      lines.push("```text");
      lines.push(data.tests.tail.trim());
      lines.push("```");
    }
  }
  lines.push("");

  lines.push("## 8. Rollback");
  lines.push("");
  if (!data.rollback.attempted) {
    lines.push("No fue necesario.");
  } else {
    lines.push(`- Resultado: ${data.rollback.ok ? "✅ restaurado" : "❌ ERROR — revisar manualmente"}`);
    if (data.rollback.error) lines.push(`- Error: ${data.rollback.error}`);
    lines.push(`- Artefactos restaurados: ${data.rollback.restoredArtifacts.map((item) => `\`${item}\``).join(", ") || "ninguno"}`);
  }
  lines.push("");

  if (data.notes.length > 0) {
    lines.push("## Notas");
    lines.push("");
    for (const note of data.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## Próximos pasos");
  lines.push("");
  if (data.status === "success") {
    lines.push("- Revisar este reporte y `git diff` (skills, prompts, rules, config).");
    lines.push("- Revisar el impacto en hooks si hay riesgo alto/medio.");
    lines.push("- Confirmar manualmente antes de commitear. El updater **no commitea**.");
  } else if (data.status === "rolled-back") {
    lines.push("- Corregir la causa (curación, allowlist, overlays o contrato de hooks).");
    lines.push("- Volver a ejecutar `npm run update-ecc -- <ref>`.");
    lines.push("- No se dejó ECC ni los artefactos generados a medias.");
  } else {
    lines.push("- Sin cambios aplicados.");
  }
  lines.push("");
  return lines.join("\n");
}
