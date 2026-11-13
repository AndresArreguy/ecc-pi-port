#!/usr/bin/env node
/**
 * Installation verification without an LLM.
 *
 * Starts Pi in RPC mode from a clean project, asks for `get_commands`, and
 * checks that the installed package contributes skills, prompt templates,
 * extension commands and that the ECC session hook actually ran.
 *
 * Usage:
 *   node tests/pi-port/verify-install.mjs [--project <dir>] [--package <dir>]
 *
 * Requires the package to be installed already (`pi install <package>`).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const args = {
    project: path.join(REPO_ROOT, ".pi-port", "clean-install-project"),
    packageRoot: REPO_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.project = path.resolve(argv[++i]);
    else if (argv[i] === "--package") args.packageRoot = path.resolve(argv[++i]);
  }
  return args;
}

function findPiCli() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
    );
  }
  if (process.env.PI_CLI) candidates.push(process.env.PI_CLI);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Pi CLI bundle not found (set PI_CLI or APPDATA)");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listLeaseFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLeaseFiles(full));
    else if (entry.name.endsWith(".json") && full.includes(".observer-sessions")) out.push(full);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageRoot = args.packageRoot;
  const project = args.project;
  fs.mkdirSync(project, { recursive: true });

  const homunculusDir = path.join(project, ".ecc-homunculus");
  fs.rmSync(homunculusDir, { recursive: true, force: true });
  const probeOut = path.join(project, ".probe-tools.json");
  fs.rmSync(probeOut, { force: true });

  const cli = findPiCli();
  const probeExtension = path.join(__dirname, "probe-tools.mjs");
  const child = spawn(
    process.execPath,
    [cli, "--mode", "rpc", "--no-session", "--offline", "-e", probeExtension],
    {
      cwd: project,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLV2_HOMUNCULUS_DIR: homunculusDir,
        PI_ECC_PROBE_OUT: probeOut,
        ECC_HOOK_PROFILE: "standard",
      },
      windowsHide: true,
    },
  );

  const stdoutChunks = [];
  const stderrChunks = [];
  let buffer = "";
  const events = [];

  child.stdout.on("data", (data) => {
    const text = data.toString();
    stdoutChunks.push(text);
    buffer += text;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        events.push({ type: "unparsed", line });
      }
    }
  });
  child.stderr.on("data", (data) => stderrChunks.push(data.toString()));

  const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  const waitForResponse = async (command, timeoutMs = 25_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = events.find((event) => event.type === "response" && event.command === command);
      if (response) return response;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for RPC response: ${command}`);
  };

  await sleep(4000); // let extensions load and session_start hooks finish
  send({ id: "commands", type: "get_commands" });
  const commandsResponse = await waitForResponse("get_commands");
  await sleep(1000); // allow async hooks to flush side effects

  const leases = listLeaseFiles(homunculusDir);
  const extensionErrors = events.filter((event) => event.type === "extension_error");

  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  await sleep(500);
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }

  const commands = commandsResponse?.data?.commands ?? [];
  const fromPackage = commands.filter((command) => {
    const base = command?.sourceInfo?.baseDir;
    return typeof base === "string" && path.resolve(base) === path.resolve(packageRoot);
  });
  const skills = fromPackage.filter((command) => command.source === "skill");
  const prompts = fromPackage.filter((command) => command.source === "prompt");
  const extensionCommands = fromPackage.filter((command) => command.source === "extension");

  const expectedPrompts = ["plan-prd", "plan", "prp-implement", "feature-dev", "code-review", "test-coverage", "quality-gate"];
  const missingPrompts = expectedPrompts.filter((name) => !prompts.some((command) => command.name === name));
  const expectedExtensionCommands = ["ecc-rules", "sdd-model", "sdd-spec", "sdd-plan", "sdd-implement", "sdd-review", "sdd-verify"];
  const missingExtensionCommands = expectedExtensionCommands.filter((name) => !extensionCommands.some((command) => command.name === name));

  const agentsFile = path.join(packageRoot, "config", "agents-generated.json");
  const agents = fs.existsSync(agentsFile) ? JSON.parse(fs.readFileSync(agentsFile, "utf8")).agents : [];
  const tools = fs.existsSync(probeOut) ? JSON.parse(fs.readFileSync(probeOut, "utf8")) : [];
  const runAgent = tools.find((tool) => tool.name === "run_agent");

  const checks = [
    { name: "package skills discovered (>= 120)", ok: skills.length >= 120, detail: `${skills.length} skills` },
    {
      name: "known skill discovered (verification-loop)",
      ok: skills.some((command) => command.name === "skill:verification-loop"),
      detail: skills.some((command) => command.name === "skill:verification-loop") ? "ok" : "missing",
    },
    { name: "prompt templates discovered", ok: missingPrompts.length === 0, detail: missingPrompts.length === 0 ? `${prompts.length} prompts` : `missing: ${missingPrompts.join(", ")}` },
    {
      name: "extension commands registered",
      ok: missingExtensionCommands.length === 0,
      detail: missingExtensionCommands.length === 0 ? `${extensionCommands.length} commands` : `missing: ${missingExtensionCommands.join(", ")}`,
    },
    { name: "no extension load errors", ok: extensionErrors.length === 0, detail: extensionErrors.length === 0 ? "none" : JSON.stringify(extensionErrors).slice(0, 500) },
    { name: "ECC session_start hook ran (lease written)", ok: leases.length > 0, detail: leases.length > 0 ? `${leases.length} lease(s)` : "no lease found" },
    { name: "agent definitions available", ok: agents.length >= 6, detail: `${agents.length} agents` },
    {
      name: "run_agent tool registered and active",
      ok: Boolean(runAgent && runAgent.active),
      detail: runAgent ? (runAgent.active ? "active" : "registered but inactive") : "missing (probe failed)",
    },
  ];

  console.log(`Pi package: ${packageRoot}`);
  console.log(`Project:    ${project}`);
  console.log(`Pi CLI:     ${cli}\n`);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name} (${check.detail})`);

  if (extensionErrors.length > 0) {
    console.log("\nExtension errors:");
    for (const error of extensionErrors) console.log(JSON.stringify(error).slice(0, 2000));
  }
  const stderr = stderrChunks.join("");
  if (stderr.trim()) {
    console.log("\nPi stderr (tail):");
    console.log(stderr.trim().split(/\r?\n/).slice(-20).join("\n"));
  }

  const failed = checks.filter((check) => !check.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

  // Leave the clean project as clean as we found it.
  fs.rmSync(homunculusDir, { recursive: true, force: true });
  fs.rmSync(probeOut, { force: true });
  fs.rmSync(path.join(project, ".pi-port"), { recursive: true, force: true });

  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
