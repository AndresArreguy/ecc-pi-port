/**
 * Probe extension for tests/pi-port/verify-install.mjs.
 * Writes the tool inventory (names + active state) to PI_ECC_PROBE_OUT.
 */
import fs from "node:fs";

export default function probeToolsExtension(pi) {
  pi.on("session_start", async () => {
    const out = process.env.PI_ECC_PROBE_OUT;
    if (!out) return;
    const active = new Set(pi.getActiveTools());
    const tools = pi.getAllTools().map((tool) => ({
      name: tool.name,
      active: active.has(tool.name),
      source: tool.sourceInfo?.source ?? null,
    }));
    fs.writeFileSync(out, `${JSON.stringify(tools, null, 2)}\n`, "utf8");
  });
}
