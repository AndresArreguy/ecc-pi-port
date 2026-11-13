import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const TEST_PROJECT = path.join(ROOT, ".pi-port", "test-sdd-project");
const LOG_DIR = path.join(ROOT, ".pi-port", "sdd-rpc-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

function findPiCli() {
  const appData = process.env.APPDATA;
  if (appData) {
    const p = path.join(appData, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Pi CLI bundle not found");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const cli = findPiCli();
  const args = [
    cli,
    "--mode", "rpc",
    "--no-session",
    "-e", path.join(ROOT, "extensions", "ecc-sdd.ts"),
  ];

  const child = spawn(process.execPath, args, {
    cwd: TEST_PROJECT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });

  const out = [];
  const err = [];
  let buffer = "";
  child.stdout.on("data", (d) => {
    const s = d.toString();
    out.push(s);
    buffer += s;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        // keep concise console view
        if (obj.type === "response" || obj.type === "extension_error" || obj.type === "agent_end" || obj.type === "agent_settled" || obj.type === "auto_retry_end") {
          console.log("EVT", JSON.stringify(obj));
        } else if (obj.type === "message_end" && obj.message?.role === "assistant") {
          console.log("EVT assistant_end", JSON.stringify({ stopReason: obj.message.stopReason, errorMessage: obj.message.errorMessage, usage: obj.message.usage, model: obj.message.model, provider: obj.message.provider }));
        } else if (obj.type === "turn_end") {
          console.log("EVT turn_end");
        } else if (obj.type === "agent_start") {
          console.log("EVT agent_start");
        }
      } catch {
        console.log("RAW", line.slice(0, 200));
      }
    }
  });
  child.stderr.on("data", (d) => { const s = d.toString(); err.push(s); });

  const send = (obj) => {
    console.log("SEND", JSON.stringify(obj));
    child.stdin.write(JSON.stringify(obj) + "\n");
  };

  await sleep(1500);
  send({ id: "cfg", type: "prompt", message: "/sdd-model" });
  await sleep(2000);

  const feature = "add-user-endpoint";
  const specReq = "Feature: Add POST /users endpoint with validation. Accepts JSON {name,email,age}. name required string (2-50 chars), email required valid format, age optional integer >= 0. Returns 201 with created user id and echo fields on success, 400 with validation errors on invalid input. Keep implementation minimal in src/server.mjs with tests in tests/.";

  send({ id: "spec", type: "prompt", message: `/sdd-spec ${feature} ${specReq}` });
  await sleep(20000);

  send({ id: "plan", type: "prompt", message: `/sdd-plan ${feature}` });
  await sleep(20000);

  send({ id: "impl", type: "prompt", message: `/sdd-implement ${feature}` });
  await sleep(25000);

  send({ id: "review", type: "prompt", message: `/sdd-review ${feature}` });
  await sleep(20000);

  send({ id: "verify", type: "prompt", message: `/sdd-verify ${feature}` });
  await sleep(20000);

  try { send({ id: "abort", type: "abort" }); } catch {}
  await sleep(1000);
  try { child.kill("SIGTERM"); } catch {}
  await sleep(1000);
  try { child.kill("SIGKILL"); } catch {}

  fs.writeFileSync(path.join(LOG_DIR, "stdout.log"), out.join(""), "utf8");
  fs.writeFileSync(path.join(LOG_DIR, "stderr.log"), err.join(""), "utf8");
  console.log("WROTE LOGS", LOG_DIR);
}

run().catch((e) => { console.error(e); process.exit(1); });
