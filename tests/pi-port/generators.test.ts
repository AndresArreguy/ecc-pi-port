import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateAll } from "../../scripts/lib/generate.ts";
import { generateSkills } from "../../scripts/lib/generate-skills.ts";

interface Fixture {
  root: string;
  eccRoot: string;
  configRoot: string;
  outRoot: string;
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-generators-test-"));
  const eccRoot = path.join(root, "ecc");
  const configRoot = path.join(root, "config");
  const outRoot = path.join(root, "out");

  write(path.join(eccRoot, "VERSION"), "9.9.9\n");
  write(
    path.join(eccRoot, "manifests", "pi-core.json"),
    JSON.stringify({
      skills: {
        include: ["alpha", "council"],
        exclude: {},
        rename: { council: "ecc-council" },
      },
    }),
  );
  write(
    path.join(eccRoot, "skills", "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: Alpha skill for tests.\n---\n\n# Alpha\n",
  );
  write(
    path.join(eccRoot, "skills", "alpha", "references", "note.md"),
    "# reference\n",
  );
  write(
    path.join(eccRoot, "skills", "council", "SKILL.md"),
    "---\nname: council\ndescription: Council skill for tests.\n---\n\n# Council\n",
  );
  write(
    path.join(eccRoot, "commands", "sample.md"),
    "---\ndescription: Sample command\n---\n\n# Sample\n\nDo the thing.\n",
  );
  write(
    path.join(eccRoot, "agents", "helper.md"),
    [
      "---",
      "name: helper",
      "description: Helper agent",
      "tools: Read, Grep, Bash, WebSearch",
      "model: sonnet",
      "---",
      "",
      "# Helper",
      "",
      "You help.",
    ].join("\n"),
  );
  write(path.join(eccRoot, "rules", "README.md"), "# source readme\n");
  write(path.join(eccRoot, "rules", "common", "coding-style.md"), "# Common\n");
  write(path.join(eccRoot, "rules", "typescript", "patterns.md"), "# TS\n");

  write(
    path.join(configRoot, "commands-allowlist.json"),
    JSON.stringify({
      version: 1,
      commands: [{ source: "sample.md", name: "sample", sddRole: "plan", status: "ready" }],
    }),
  );
  write(
    path.join(configRoot, "agents-subset.json"),
    JSON.stringify({ agents: ["helper"] }),
  );

  return { root, eccRoot, configRoot, outRoot };
}

test("generateAll produces skills, rules, prompts and agent data from ecc", () => {
  const fixture = makeFixture();
  const result = generateAll({
    eccRoot: fixture.eccRoot,
    configRoot: fixture.configRoot,
    outRoot: fixture.outRoot,
    docsRoot: path.join(fixture.outRoot, "docs", "pi-port"),
  });

  assert.equal(result.eccVersion, "9.9.9");
  assert.equal(result.skills.copied, 2);
  assert.equal(result.prompts.commands, 1);
  assert.equal(result.agents.agents, 1);
  assert.equal(result.rules.stacks, 2);

  // skills: copied, renamed frontmatter, supporting files preserved
  assert.ok(fs.existsSync(path.join(fixture.outRoot, "skills", "alpha", "references", "note.md")));
  const council = fs.readFileSync(path.join(fixture.outRoot, "skills", "ecc-council", "SKILL.md"), "utf8");
  assert.match(council, /^---\nname: ecc-council/m);

  // rules: index generated, source README not copied verbatim
  const rulesIndex = fs.readFileSync(path.join(fixture.outRoot, "rules", "README.md"), "utf8");
  assert.match(rulesIndex, /typescript/);
  assert.doesNotMatch(rulesIndex, /source readme/);

  // prompts: frontmatter + provenance header
  const prompt = fs.readFileSync(path.join(fixture.outRoot, "prompts", "sample.md"), "utf8");
  assert.match(prompt, /description: Sample command/);
  assert.match(prompt, /Source: ecc\/commands\/sample.md/);
  assert.ok(fs.existsSync(path.join(fixture.outRoot, "docs", "pi-port", "02-commands.md")));

  // agents: tool mapping and deterministic version stamp
  const generated = JSON.parse(
    fs.readFileSync(path.join(fixture.outRoot, "config", "agents-generated.json"), "utf8"),
  ) as {
    sourceVersion: string;
    agents: Array<{ name: string; piTools: string[]; unmappedTools: string[]; systemPrompt: string }>;
  };
  assert.equal(generated.sourceVersion, "9.9.9");
  assert.equal((generated as { sourceRef?: string | null }).sourceRef, null);
  assert.equal(generated.agents[0].name, "helper");
  assert.deepEqual(generated.agents[0].piTools, ["read", "grep", "bash", "websearch"]);
  assert.deepEqual(generated.agents[0].unmappedTools, ["WebSearch"]);
  assert.match(generated.agents[0].systemPrompt, /You help/);
});

test("skills generation fails on curation drift", () => {
  const fixture = makeFixture();
  const rogue = path.join(fixture.eccRoot, "skills", "rogue");
  write(path.join(rogue, "SKILL.md"), "---\nname: rogue\ndescription: not classified\n---\n");
  assert.throws(
    () => generateSkills({ eccRoot: fixture.eccRoot, outRoot: fixture.outRoot }),
    /curation drift[\s\S]*rogue/,
  );
});

test("skills generation fails when a manifest entry is missing on disk", () => {
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.eccRoot, "skills", "alpha"), { recursive: true, force: true });
  assert.throws(
    () => generateSkills({ eccRoot: fixture.eccRoot, outRoot: fixture.outRoot }),
    /references missing skills\/alpha/,
  );
});

test("overlays/skills/<name> replaces the ECC base skill", () => {
  const fixture = makeFixture();
  write(
    path.join(fixture.root, "overlays", "skills", "alpha", "SKILL.md"),
    ["---", "name: alpha", "description: Overlay alpha.", "---", "", "# Overlay alpha", ""].join(String.fromCharCode(10)),
  );
  write(path.join(fixture.root, "overlays", "skills", "alpha", "extra.md"), "overlay only" + String.fromCharCode(10));

  const result = generateSkills({
    eccRoot: fixture.eccRoot,
    outRoot: fixture.outRoot,
    overlaysRoot: path.join(fixture.root, "overlays"),
  });

  assert.equal(result.overlays.length, 1);
  assert.equal(result.overlays[0].skill, "alpha");
  const content = fs.readFileSync(path.join(fixture.outRoot, "skills", "alpha", "SKILL.md"), "utf8");
  assert.match(content, /Overlay alpha/);
  assert.ok(fs.existsSync(path.join(fixture.outRoot, "skills", "alpha", "extra.md")));
});

test("overlays with a mismatched name fail the build", () => {
  const fixture = makeFixture();
  write(
    path.join(fixture.root, "overlays", "skills", "alpha", "SKILL.md"),
    ["---", "name: something-else", "description: Wrong name.", "---", ""].join(String.fromCharCode(10)),
  );
  assert.throws(
    () =>
      generateSkills({
        eccRoot: fixture.eccRoot,
        outRoot: fixture.outRoot,
        overlaysRoot: path.join(fixture.root, "overlays"),
      }),
    /declares name "something-else"/,
  );
});
