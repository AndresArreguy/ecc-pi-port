import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectStacks,
  listRuleStacks,
  loadRules,
  resolveActiveStacks,
} from "../../lib/ecc-rules-core.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-rules-test-"));
}

function makeRulesRoot(): string {
  const root = tempDir();
  for (const stack of ["common", "typescript", "react", "python"]) {
    fs.mkdirSync(path.join(root, stack), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "common", "coding-style.md"), "# Common\nBe consistent.");
  fs.writeFileSync(path.join(root, "typescript", "patterns.md"), "# TS\nUse strict mode.");
  fs.writeFileSync(path.join(root, "react", "patterns.md"), "# React\nPrefer hooks.");
  fs.writeFileSync(path.join(root, "python", "patterns.md"), "# Python\nUse type hints.");
  return root;
}

test("lists rule stacks sorted and ignores files", () => {
  const root = makeRulesRoot();
  assert.deepEqual(listRuleStacks(root), ["common", "python", "react", "typescript"]);
});

test("detects stacks from project markers", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0" } }));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  const stacks = detectStacks(dir);
  assert.ok(stacks.includes("web"));
  assert.ok(stacks.includes("typescript"));
  assert.ok(stacks.includes("react"));

  const nativeDir = tempDir();
  fs.writeFileSync(path.join(nativeDir, "package.json"), JSON.stringify({ dependencies: { "react-native": "0.7.0", react: "19.0.0" } }));
  assert.ok(detectStacks(nativeDir).includes("react-native"));
  assert.ok(!detectStacks(nativeDir).includes("react"));

  const goDir = tempDir();
  fs.writeFileSync(path.join(goDir, "go.mod"), "module x");
  assert.deepEqual(detectStacks(goDir), ["golang"]);
});

test("resolves explicit, auto and off selections", () => {
  const rulesRoot = makeRulesRoot();
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "tsconfig.json"), "{}");

  const explicit = resolveActiveStacks("typescript python", cwd, rulesRoot);
  assert.deepEqual(explicit.stacks, ["common", "typescript", "python"]);
  assert.deepEqual(explicit.invalid, []);

  const auto = resolveActiveStacks("auto", cwd, rulesRoot);
  assert.ok(auto.stacks.includes("common"));
  assert.ok(auto.stacks.includes("typescript"));

  assert.deepEqual(resolveActiveStacks("off", cwd, rulesRoot), { stacks: [], invalid: [] });

  const invalid = resolveActiveStacks("typescript bogus", cwd, rulesRoot);
  assert.deepEqual(invalid.invalid, ["bogus"]);
  assert.deepEqual(invalid.stacks, ["common", "typescript"]);
});

test("loads rules with a character budget and reports missing stacks", () => {
  const rulesRoot = makeRulesRoot();
  const loaded = loadRules(rulesRoot, ["common", "typescript"], 10_000);
  assert.equal(loaded.truncated, false);
  assert.deepEqual(loaded.files, ["common/coding-style.md", "typescript/patterns.md"]);
  assert.match(loaded.text, /<ecc-rules>/);
  assert.match(loaded.text, /Use strict mode/);

  const truncated = loadRules(rulesRoot, ["common", "typescript"], 20);
  assert.equal(truncated.truncated, true);

  const missing = loadRules(rulesRoot, ["common", "nope"], 10_000);
  assert.deepEqual(missing.missingStacks, ["nope"]);
  assert.deepEqual(missing.files, ["common/coding-style.md"]);

  assert.equal(loadRules(rulesRoot, [], 10_000).text, "");
});
