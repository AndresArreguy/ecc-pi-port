import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPDATE_SCRIPT = path.join(REPO_ROOT, "scripts", "update-ecc.ts");
const BUILD_SCRIPT = path.join(REPO_ROOT, "scripts", "build.ts");

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || "").trim();
}

function makeFixture(): { root: string; eccDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ecc-update-e2e-"));
  const eccDir = path.join(root, "ecc");
  fs.mkdirSync(eccDir, { recursive: true });

  write(eccDir, "VERSION", "1.0.0\n");
  write(eccDir, "manifests/pi-core.json", JSON.stringify({ skills: { include: ["alpha"], exclude: {}, rename: {} } }, null, 2));
  write(eccDir, "skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Alpha fixture skill.\n---\n\n# Alpha\n");
  write(eccDir, "commands/sample.md", "---\ndescription: Sample command\n---\n\n# Sample\n\nDo it.\n");
  write(
    eccDir,
    "agents/helper.md",
    "---\nname: helper\ndescription: Helper agent\ntools: Read, Bash\n---\n\n# Helper\n\nYou help.\n",
  );
  write(eccDir, "rules/common/coding-style.md", "# Common rules\n");
  write(eccDir, "hooks/hooks.json", JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node scripts/hooks/run-with-flags.js pre:bash:dispatcher scripts/hooks/pre-bash-dispatcher.js minimal,standard,strict",
            },
          ],
        },
      ],
    },
  }, null, 2));
  write(eccDir, "scripts/hooks/pre-bash-dispatcher.js", "module.exports = { runPreBash: () => ({ exitCode: 0 }) };\n");
  write(eccDir, "scripts/hooks/run-with-flags.js", "module.exports = {};\n");
  write(eccDir, "scripts/lib/hook-flags.js", "module.exports = {};\n");
  write(eccDir, "scripts/lib/hook-input.js", "module.exports = {};\n");

  write(root, "config/commands-allowlist.json", JSON.stringify({
    version: 1,
    commands: [{ source: "sample.md", name: "sample", sddRole: "plan", status: "ready" }],
  }, null, 2));
  write(root, "config/agents-subset.json", JSON.stringify({ agents: ["helper"] }, null, 2));
  write(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "fixture",
        version: "0.0.0",
        type: "module",
        pi: { skills: ["./skills"], prompts: ["./prompts"] },
      },
      null,
      2,
    ),
  );

  git(eccDir, ["init"]);
  git(eccDir, ["config", "user.email", "test@example.com"]);
  git(eccDir, ["config", "user.name", "Test"]);
  git(eccDir, ["add", "."]);
  git(eccDir, ["commit", "-m", "fixture v1"]);
  git(eccDir, ["tag", "v1.0.0"]);
  return { root, eccDir };
}

function commitV2(eccDir: string, options: { keepCommand: boolean }): void {
  write(eccDir, "VERSION", "1.1.0\n");
  write(
    eccDir,
    "manifests/pi-core.json",
    JSON.stringify({ skills: { include: ["alpha", "beta"], exclude: {}, rename: {} } }, null, 2),
  );
  write(eccDir, "skills/beta/SKILL.md", "---\nname: beta\ndescription: Beta fixture skill.\n---\n\n# Beta\n");
  write(
    eccDir,
    "scripts/hooks/pre-bash-dispatcher.js",
    "module.exports = { runPreBash: () => ({ exitCode: 0, hookSpecificOutput: { additionalContext: 'x' } }) };\n",
  );
  if (!options.keepCommand) fs.rmSync(path.join(eccDir, "commands", "sample.md"));
  git(eccDir, ["add", "-A"]);
  git(eccDir, ["commit", "-m", "fixture v2"]);
  git(eccDir, ["tag", "v1.1.0"]);
}

function runUpdater(
  root: string,
  eccDir: string,
  ref: string,
  options: { skipTests?: boolean } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      UPDATE_SCRIPT,
      "--root",
      root,
      "--ecc",
      eccDir,
      "--no-fetch",
      ...(options.skipTests === false ? [] : ["--skip-tests"]),
      ref,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, timeout: 120_000 },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runBuild(root: string, eccDir: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BUILD_SCRIPT, "--ecc", eccDir, "--out", root, "--config", path.join(root, "config"), "--docs", path.join(root, "docs", "pi-port")],
    { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, timeout: 120_000 },
  );
  assert.equal(result.status, 0, `build failed: ${result.stderr || result.stdout}`);
}

function latestReport(root: string): string {
  const dir = path.join(root, "docs", "pi-port");
  const files = fs.readdirSync(dir).filter((file) => file.startsWith("update-")).sort();
  assert.ok(files.length > 0, "no update report written");
  return fs.readFileSync(path.join(dir, files.at(-1)!), "utf8");
}

test("update-ecc applies a local tag, rebuilds artifacts and writes the lock/report", () => {
  const { root, eccDir } = makeFixture();
  commitV2(eccDir, { keepCommand: true });
  git(eccDir, ["checkout", "--detach", "v1.0.0"]);

  const result = runUpdater(root, eccDir, "v1.1.0");
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const v2Commit = git(eccDir, ["rev-parse", "v1.1.0"]);
  assert.equal(git(eccDir, ["rev-parse", "HEAD"]), v2Commit);

  const lock = JSON.parse(fs.readFileSync(path.join(root, "ecc.lock"), "utf8")) as { ref: string; commit: string; version: string };
  assert.equal(lock.ref, "v1.1.0");
  assert.equal(lock.commit, v2Commit);
  assert.equal(lock.version, "1.1.0");

  assert.ok(fs.existsSync(path.join(root, "skills", "beta", "SKILL.md")), "new skill was not built");
  assert.ok(fs.existsSync(path.join(root, "prompts", "sample.md")), "prompts were not rebuilt");
  const agents = JSON.parse(fs.readFileSync(path.join(root, "config", "agents-generated.json"), "utf8")) as { sourceRef?: string };
  assert.equal(agents.sourceRef, "v1.1.0");

  const report = latestReport(root);
  assert.match(report, /actualización aplicada/);
  assert.match(report, /## 4\. Hooks/);
  assert.match(report, /hookSpecificOutput/);
});

test("update-ecc rolls back ECC and artifacts when the build fails", () => {
  const { root, eccDir } = makeFixture();
  runBuild(root, eccDir);
  assert.ok(fs.existsSync(path.join(root, "prompts", "sample.md")));
  const v1Commit = git(eccDir, ["rev-parse", "v1.0.0"]);

  commitV2(eccDir, { keepCommand: false });
  git(eccDir, ["checkout", "--detach", "v1.0.0"]);

  const result = runUpdater(root, eccDir, "v1.1.0");
  assert.notEqual(result.status, 0, "updater should fail when the build fails");

  assert.equal(git(eccDir, ["rev-parse", "HEAD"]), v1Commit, "ECC was not restored");
  assert.equal(fs.existsSync(path.join(root, "ecc.lock")), false, "lock should not be created on rollback");
  assert.ok(fs.existsSync(path.join(root, "skills", "alpha", "SKILL.md")), "old skills were not restored");
  assert.equal(fs.existsSync(path.join(root, "skills", "beta")), false, "new skills leaked after rollback");
  assert.ok(fs.existsSync(path.join(root, "prompts", "sample.md")), "old prompts were not restored");

  const report = latestReport(root);
  assert.match(report, /rollback aplicado/);
  assert.match(report, /Source command missing/);
});

test("update-ecc rolls back when the test suite fails", () => {
  const { root, eccDir } = makeFixture();
  const v1Commit = git(eccDir, ["rev-parse", "v1.0.0"]);
  // Force `npm test` in the fixture to fail.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
  pkg.scripts = { test: 'node -e "process.exit(1)"' };
  write(root, "package.json", JSON.stringify(pkg, null, 2));

  commitV2(eccDir, { keepCommand: true });
  git(eccDir, ["checkout", "--detach", "v1.0.0"]);

  const result = runUpdater(root, eccDir, "v1.1.0", { skipTests: false });
  assert.notEqual(result.status, 0, "updater should fail when tests fail");
  assert.equal(git(eccDir, ["rev-parse", "HEAD"]), v1Commit, "ECC was not restored after test failure");
  assert.equal(fs.existsSync(path.join(root, "ecc.lock")), false, "lock should not be created when tests fail");

  const report = latestReport(root);
  assert.match(report, /rollback aplicado/);
  assert.match(report, /Tests fallaron/);
});
