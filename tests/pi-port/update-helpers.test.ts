import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEccLock, writeEccLock } from "../../scripts/lib/ecc-lock.ts";
import {
  analyzeCommands,
  analyzeHooks,
  analyzeSkills,
  parseHooksJson,
  renderUpdateReport,
  type UpdateReportData,
} from "../../scripts/lib/ecc-report.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-update-helpers-"));
}

test("analyzeSkills reports removals, renames, drift and new skills", () => {
  const analysis = analyzeSkills({
    oldDirs: ["alpha", "council", "legacy"],
    newDirs: ["alpha", "gamma", "excluded-new", "unclassified-new"],
    oldManifest: {
      include: ["alpha", "council", "legacy"],
      exclude: {},
      rename: { council: "ecc-council" },
    },
    newManifest: {
      include: ["alpha", "gamma", "phantom"],
      exclude: { "excluded-new": "not portable" },
      rename: { alpha: "ecc-alpha", council: "ecc-council" },
    },
    overlays: ["alpha", "council"],
    changedFiles: ["skills/alpha/SKILL.md", "skills/council/SKILL.md"],
  });

  assert.deepEqual(analysis.removedFromAllowlist, ["legacy"]);
  assert.ok(analysis.renamed.some((entry) => entry.from === "alpha" && entry.to === "ecc-alpha"));
  assert.deepEqual(analysis.missingOnDisk, ["phantom"]);
  assert.deepEqual(analysis.unclassifiedNew, ["unclassified-new"]);
  assert.deepEqual(analysis.newExcluded, ["excluded-new"]);
  assert.deepEqual(analysis.newNotInAllowlist, ["excluded-new", "unclassified-new"]);
  assert.ok(analysis.addedToAllowlist.includes("gamma"));
  assert.equal(analysis.overlays.find((overlay) => overlay.name === "alpha")?.baseChanged, true);
  assert.equal(analysis.overlays.find((overlay) => overlay.name === "council")?.baseChanged, true);
});

test("analyzeCommands distinguishes new commands from port breakage", () => {
  const analysis = analyzeCommands({
    oldCommands: ["a", "b", "old"],
    newCommands: ["a", "c", "d"],
    portSources: ["a.md", "old.md", "missing.md"],
  });
  assert.deepEqual(analysis.added, ["c", "d"]);
  assert.deepEqual(analysis.removed, ["b", "old"]);
  assert.deepEqual(analysis.addedNotInPort, ["c", "d"]);
  assert.deepEqual(analysis.removedFromPort, ["old"]);
  assert.deepEqual(analysis.missingSources, ["old.md", "missing.md"]);
});

test("parseHooksJson extracts event, matcher, id and script", () => {
  const json = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node -e \"...\" node scripts/hooks/run-with-flags.js pre:bash:dispatcher scripts/hooks/pre-bash-dispatcher.js minimal,standard,strict",
            },
          ],
        },
      ],
    },
  });
  assert.deepEqual(parseHooksJson(json), [
    {
      event: "PreToolUse",
      matcher: "Bash",
      hookId: "pre:bash:dispatcher",
      script: "scripts/hooks/pre-bash-dispatcher.js",
    },
  ]);
  assert.equal(parseHooksJson(null), null);
  assert.deepEqual(parseHooksJson("not json"), null);
});

test("analyzeHooks flags contract changes and missing adapter scripts", () => {
  const oldHooks = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node x scripts/hooks/run-with-flags.js pre:bash:dispatcher scripts/hooks/pre-bash-dispatcher.js minimal" }],
        },
      ],
    },
  });
  const newHooks = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node x scripts/hooks/run-with-flags.js pre:bash:dispatcher scripts/hooks/pre-bash-v2.js minimal" }],
        },
      ],
    },
  });

  const analysis = analyzeHooks({
    oldHooksJson: oldHooks,
    newHooksJson: newHooks,
    oldHookFiles: ["scripts/hooks/pre-bash-dispatcher.js", "scripts/hooks/removed.js"],
    newHookFiles: ["scripts/hooks/pre-bash-v2.js"],
    changedFiles: [
      { status: "M", path: "scripts/hooks/pre-bash-v2.js" },
      { status: "D", path: "scripts/hooks/removed.js" },
      { status: "M", path: "scripts/hooks/run-with-flags.js" },
    ],
    adapterSpecs: [{ id: "pre:bash:dispatcher", script: "scripts/hooks/pre-bash-dispatcher.js" }],
    diffs: {
      "scripts/hooks/pre-bash-v2.js":
        "+ process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: 'x' } }));\n+ process.exitCode = 2;",
      "scripts/hooks/run-with-flags.js": "+ const tool_input = payload.tool_input;",
    },
  });

  assert.equal(analysis.changed.length, 1);
  assert.equal(analysis.changed[0].newScript, "scripts/hooks/pre-bash-v2.js");
  assert.deepEqual(analysis.removedScripts, ["scripts/hooks/pre-bash-dispatcher.js", "scripts/hooks/removed.js"]);
  assert.deepEqual(analysis.newScripts, ["scripts/hooks/pre-bash-v2.js"]);
  assert.ok(analysis.changedScripts.includes("scripts/hooks/pre-bash-v2.js"));
  assert.ok(analysis.runtimeChanged.includes("scripts/hooks/run-with-flags.js"));
  assert.ok(analysis.contractFindings.some((finding) => finding.severity === "high"));
  const risk = analysis.adapterRisks.find((entry) => entry.id === "pre:bash:dispatcher");
  assert.equal(risk?.missing, true);
  assert.equal(risk?.severity, "high");
});

test("lock read/write roundtrip", () => {
  const root = tempDir();
  assert.equal(readEccLock(root), null);
  writeEccLock(root, {
    repository: "https://example.com/ecc.git",
    ref: "v1.0.0",
    commit: "abc123",
    version: "1.0.0",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const lock = readEccLock(root);
  assert.equal(lock?.commit, "abc123");
  assert.equal(lock?.version, "1.0.0");
});

test("renderUpdateReport includes all required sections", () => {
  const report: UpdateReportData = {
    command: "npm run update-ecc -- v1.1.0",
    status: "rolled-back",
    oldLock: { repository: "r", ref: "v1.0.0", commit: "oldoldold", version: "1.0.0", updatedAt: "" },
    targetLock: { repository: "r", ref: "v1.1.0", commit: "newnewnew", version: "1.1.0", updatedAt: "" },
    oldCommit: "oldoldold",
    targetCommit: "newnewnew",
    commits: ["abc feat: skill"],
    changedFiles: [{ status: "M", path: "skills/alpha/SKILL.md" }],
    skills: {
      removedFromAllowlist: ["legacy"],
      addedToAllowlist: [],
      renamed: [],
      missingOnDisk: [],
      unclassifiedNew: ["new-skill"],
      newExcluded: [],
      newNotInAllowlist: ["new-skill"],
      overlays: [{ name: "alpha", baseChanged: true, baseMissing: false, changedFiles: ["skills/alpha/SKILL.md"] }],
    },
    commands: { added: ["c"], removed: [], addedNotInPort: ["c"], removedFromPort: [], missingSources: [] },
    hooks: {
      added: [],
      removed: [],
      changed: [],
      changedScripts: ["scripts/hooks/pre-bash-dispatcher.js"],
      changedLibs: [],
      newScripts: [],
      removedScripts: [],
      runtimeChanged: [],
      contractFindings: [{ file: "scripts/hooks/pre-bash-dispatcher.js", tokens: ["hookSpecificOutput"], severity: "high" }],
      adapterRisks: [{ id: "pre:bash:dispatcher", script: "scripts/hooks/pre-bash-dispatcher.js", changed: true, missing: false, contractTokens: ["hookSpecificOutput"], severity: "high" }],
    },
    rulesChanged: [],
    agentsChanged: [],
    scriptsChanged: [],
    build: { ok: false, error: "drift" },
    tests: { ran: false, ok: false, exitCode: null, tail: "" },
    rollback: { attempted: true, ok: true, restoredArtifacts: ["skills", "ecc.lock"] },
    overlaysUsed: [],
    notes: ["nota"],
  };

  const markdown = renderUpdateReport(report);
  for (const heading of [
    "# Actualización ECC",
    "## 1. Commits",
    "## 2. Skills",
    "## 3. Commands",
    "## 4. Hooks",
    "### Formato de entrada/salida",
    "### Impacto en el adaptador",
    "## 5. Rules / Agents / Scripts",
    "## 6. Build",
    "## 7. Tests",
    "## 8. Rollback",
  ]) {
    assert.ok(markdown.includes(heading), `missing ${heading}`);
  }
  assert.match(markdown, /legacy/);
  assert.match(markdown, /new-skill/);
  assert.match(markdown, /rollback aplicado/);
});
