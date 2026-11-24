/**
 * Drives the /ecc-models editor without a terminal.
 *
 * The TUI is a closure returned by `ui.custom`, so this test captures that
 * component and feeds it keystrokes: the phases table, the agents section behind
 * Tab, the row filter, and Ctrl+S persisting both config files.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./stubs/pi-resolve-hooks.mjs", import.meta.url));

const { default: eccSddExtension } = await import("../../extensions/ecc-sdd.ts");
const { loadAgentModels } = await import("../../lib/ecc-agent-models.ts");
const { loadAgentNames } = await import("../../lib/ecc-agent-models.ts");
const { createTranslator } = await import("../../lib/ecc-sdd-i18n.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = {
  tab: "\t",
  escape: "\x1b",
  enter: "\r",
  down: "\x1b[B",
  pageDown: "\x1b[6~",
  ctrlS: "\x13",
  ctrlT: "\x14",
};

const theme = {
  bold: (text) => text,
  fg: (_color, text) => text,
  bg: (_color, text) => text,
};

const keybindings = {
  matches(data, id) {
    const map = {
      "tui.select.up": ["\x1b[A"],
      "tui.select.down": ["\x1b[B"],
      "tui.select.pageUp": ["\x1b[5~"],
      "tui.select.pageDown": ["\x1b[6~"],
    };
    return (map[id] || []).includes(data);
  },
};

function makeFakePi() {
  const commands: Array<{ name: string; options: Record<string, unknown> }> = [];
  return {
    api: {
      on() {},
      registerCommand(name: string, options: Record<string, unknown>) {
        commands.push({ name, options });
      },
      registerTool() {},
    },
    commands,
  };
}

/** Runs /ecc-models, captures the TUI component, and returns a key driver. */
async function openEditor() {
  const fake = makeFakePi();
  eccSddExtension(fake.api as never);
  const handler = fake.commands.find((command) => command.name === "ecc-models")?.options.handler as (
    args: string,
    ctx: unknown,
  ) => Promise<unknown>;

  let component: any = null;
  const renders: string[][] = [];
  const t = createTranslator("en");
  let menuCalls = 0;

  const ui = {
    notify() {},
    // First visit: "edit"; afterwards: "exit", so the menu loop terminates.
    select: async () => (menuCalls++ === 0 ? t("menu.edit") : t("menu.exit")),
    input: async () => undefined,
    confirm: async () => false,
    custom: async (factory: any) => {
      component = factory({ requestRender() {} }, theme, keybindings, () => {});
      return "closed";
    },
  };

  const modelRegistry = {
    getAvailable: () => [
      { provider: "acme", id: "model-one" },
      { provider: "acme", id: "model-two" },
    ],
  };
  const run = handler("", { cwd: ROOT, ui, hasUI: true, mode: "tui", modelRegistry });
  // ui.custom resolves immediately, so the handler can settle before we drive keys.
  await run;
  assert.ok(component, "editor component was created");

  const render = () => {
    const lines = component.render(120) as string[];
    renders.push(lines);
    return lines.join("\n");
  };

  const press = (data: string) => {
    component.handleInput(data);
    return render();
  };

  return { render, press, renders };
}

/** The /ecc-models handler, for CLI assertions that never open the TUI. */
function cliHandler() {
  const fake = makeFakePi();
  eccSddExtension(fake.api as never);
  return fake.commands.find((command) => command.name === "ecc-models")?.options.handler as (
    args: string,
    ctx: unknown,
  ) => Promise<unknown>;
}

function withTempConfigs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-models-ui-"));
  const sddPath = path.join(dir, "sdd-models.json");
  const agentsPath = path.join(dir, "agents-models.json");
  // Deterministic config: fixed language and no local profiles.
  fs.writeFileSync(
    sddPath,
    JSON.stringify(
      {
        description: "test",
        language: "en",
        activeProfile: null,
        phases: { spec: {}, plan: {}, implement: {}, review: {}, verify: {}, light: {} },
        phaseAliases: {},
        profiles: {},
      },
      null,
      2,
    ),
  );
  fs.copyFileSync(path.join(ROOT, "config", "agents-models.json"), agentsPath);
  const previous = { sdd: process.env.ECC_PI_SDD_CONFIG, agents: process.env.ECC_PI_AGENT_MODELS };
  process.env.ECC_PI_SDD_CONFIG = sddPath;
  process.env.ECC_PI_AGENT_MODELS = agentsPath;
  return {
    sddPath,
    agentsPath,
    restore() {
      if (previous.sdd === undefined) delete process.env.ECC_PI_SDD_CONFIG;
      else process.env.ECC_PI_SDD_CONFIG = previous.sdd;
      if (previous.agents === undefined) delete process.env.ECC_PI_AGENT_MODELS;
      else process.env.ECC_PI_AGENT_MODELS = previous.agents;
    },
  };
}

test("editor opens on the phases table", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    const screen = editor.render();
    assert.match(screen, /phases \(6\)/, "phases section is active by default");
    assert.match(screen, /Phase/, "phases header is rendered");
    assert.doesNotMatch(screen, /Agent/, "agents header is not rendered yet");
  } finally {
    temp.restore();
  }
});

test("Tab switches to the agents section and lists the roster", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    const screen = editor.press(KEY.tab);

    assert.match(screen, /agents \(\d+\)/, "agents section title");
    assert.match(screen, /Agent/, "agents header");
    assert.match(screen, /Showing 1-12 of \d+ agents/, "windowed roster");
    assert.match(screen, /tdd-guide|a11y-architect|agent-evaluator/, "agent names are listed");
  } finally {
    temp.restore();
  }
});

test("Tab goes back to phases and the row selection resets", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    editor.press(KEY.down);
    editor.press(KEY.down);
    const back = editor.press(KEY.tab);
    assert.match(back, /phases \(6\)/);
  } finally {
    temp.restore();
  }
});

test("Ctrl+T also toggles the section (Tab can be swallowed by the app)", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    const screen = editor.press(KEY.ctrlT);
    assert.match(screen, /agents \(\d+\)/);
  } finally {
    temp.restore();
  }
});

test("paging moves the agents window", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    const paged = editor.press(KEY.pageDown);
    assert.match(paged, /Showing 13-24 of \d+ agents/);
  } finally {
    temp.restore();
  }
});

test("the row filter narrows the agents list", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    editor.press("/");
    for (const char of "reviewer") editor.press(char);
    const filtered = editor.press(KEY.enter);

    assert.match(filtered, /Filter: reviewer/);
    assert.match(filtered, /Showing 1-12 of \d+ agents/, "filtered list is windowed too");
    assert.match(filtered, /code-reviewer/, "reviewers stay in the list");
    assert.doesNotMatch(filtered, /tdd-guide/, "filtered-out agents are gone");
  } finally {
    temp.restore();
  }
});

test("Ctrl+S writes the pinned model to the agent config", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    editor.press(KEY.enter); // opens the model picker on the first agent row
    // Type to filter the picker down to one registry model, then select it.
    for (const char of "model-one") editor.press(char);
    editor.press(KEY.enter);
    editor.press(KEY.ctrlS);

    const after = loadAgentModels(temp.agentsPath);
    const pinned = Object.entries(after.agents || {}).filter(([, value]) => {
      const entry = value as { provider?: string | null; model?: string | null };
      return Boolean(entry.provider && entry.model);
    });
    assert.ok(pinned.length > 0, "Ctrl+S persisted at least one agent pin");
  } finally {
    temp.restore();
  }
});

test("A picks one model for every agent and Ctrl+S pins the whole roster", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    const roster = loadAgentNames();

    const picker = editor.press("a");
    assert.match(picker, new RegExp(`Model for ${roster.length} agents`), "picker is scoped to the whole list");
    assert.match(picker, /Current: \(mixed\)|\(no override\)/, "bulk picker summarizes the current value");

    for (const char of "model-two") editor.press(char);
    editor.press(KEY.enter);
    const applied = editor.render();
    assert.match(applied, new RegExp(`Model for ${roster.length} agents: acme/model-two`));

    editor.press(KEY.ctrlS);
    const after = loadAgentModels(temp.agentsPath);
    for (const name of roster) {
      const entry = after.agents?.[name] as { provider?: string; model?: string } | undefined;
      assert.equal(entry?.provider, "acme", `${name} is pinned to the bulk provider`);
      assert.equal(entry?.model, "model-two", `${name} is pinned to the bulk model`);
    }
    assert.equal(after.agents?.["tdd-guide"]?.maxTurns, 40, "runtime limits survive the bulk pin");
  } finally {
    temp.restore();
  }
});

test("the agents section filter narrows what A applies the model to", async () => {
  const temp = withTempConfigs();
  try {
    const editor = await openEditor();
    editor.render();
    editor.press(KEY.tab);
    editor.press("/");
    for (const char of "reviewer") editor.press(char);
    editor.press(KEY.enter);
    editor.press("a");
    for (const char of "model-one") editor.press(char);
    editor.press(KEY.enter);
    editor.press(KEY.ctrlS);

    const after = loadAgentModels(temp.agentsPath);
    const pinned = Object.entries(after.agents || {})
      .filter(([, value]) => Boolean((value as { model?: string }).model))
      .map(([name]) => name)
      .sort();
    assert.ok(pinned.length > 0, "filtered reviewers got the model");
    assert.ok(pinned.every((name) => name.includes("reviewer")), `only reviewers: ${pinned.join(", ")}`);
  } finally {
    temp.restore();
  }
});

test("CLI 'agents <provider> <model>' pins every roster agent and keeps limits", async () => {
  const temp = withTempConfigs();
  try {
    const handler = cliHandler();
    const notes: string[] = [];
    const ctx = { cwd: ROOT, ui: { notify: (message: string) => notes.push(message) } };
    const roster = loadAgentNames();

    await handler("agents acme model-one", ctx);
    const after = loadAgentModels(temp.agentsPath);
    for (const name of roster) {
      const entry = after.agents?.[name] as { provider?: string; model?: string; maxTurns?: number } | undefined;
      assert.equal(entry?.provider, "acme");
      assert.equal(entry?.model, "model-one");
    }
    assert.equal(after.agents?.["tdd-guide"]?.maxTurns, 40, "limits are untouched");
    assert.ok(notes.some((note) => /Agents: \d+ pinned/.test(note)), "CLI reports the bulk pin");

    await handler("agents", ctx);
    await handler("agents acme", ctx);
    assert.ok(notes.some((note) => /Usage: \/ecc-models/.test(note)), "incomplete arguments show usage");

    await handler("agents clear", ctx);
    const cleared = loadAgentModels(temp.agentsPath);
    for (const name of roster) {
      const entry = cleared.agents?.[name] as { provider?: string | null; model?: string | null } | undefined;
      assert.equal(entry?.provider, null, `${name} provider cleared`);
      assert.equal(entry?.model, null, `${name} model cleared`);
    }
  } finally {
    temp.restore();
  }
});
