/**
 * Minimal stand-ins for the Pi peer packages so the extension modules can be
 * imported by node tests. Behaviour is intentionally dumb: these stubs only
 * exercise import-time code and command registration, never real TUI rendering.
 */

export class Input {
  constructor(_options) {
    this.value = "";
    this.focused = false;
  }
  setValue(value) {
    this.value = value ?? "";
  }
  getValue() {
    return this.value;
  }
  handleInput(data) {
    if (typeof data !== "string" || !data) return;
    if (data === "\x7f" || data === "\b") {
      this.value = this.value.slice(0, -1);
      return;
    }
    if (data === "\r" || data === "\n" || data === "\t" || data.startsWith("\x1b")) return;
    if (data >= " ") this.value += data;
  }
  render() {
    return [this.value];
  }
}

export class SelectList {
  constructor(items = []) {
    this.items = items;
    this.index = 0;
  }
  setSelectedIndex(index) {
    this.index = index;
  }
  handleInput() {}
  getSelectedItem() {
    return this.items[this.index];
  }
  render() {
    return this.items.map((item) => String(item.label ?? item.value ?? item));
  }
}

export function fuzzyFilter(items, query, getText) {
  const needle = String(query ?? "").toLowerCase().trim();
  if (!needle) return items;
  return items.filter((item) => {
    const text = getText ? getText(item) : item;
    return String(text).toLowerCase().includes(needle);
  });
}

const SPECIAL_KEYS = {
  tab: ["\t"],
  "shift+tab": ["\x1b[Z"],
  escape: ["\x1b"],
  esc: ["\x1b"],
  enter: ["\r", "\n"],
  return: ["\r", "\n"],
  space: [" "],
  backspace: ["\x7f", "\b"],
  delete: ["\x1b[3~"],
  up: ["\x1b[A"],
  down: ["\x1b[B"],
  right: ["\x1b[C"],
  left: ["\x1b[D"],
  pageUp: ["\x1b[5~"],
  pageDown: ["\x1b[6~"],
  "ctrl+s": ["\x13"],
  "ctrl+p": ["\x10"],
  "ctrl+t": ["\x14"],
};

export function matchesKey(data, keyId) {
  if (typeof data !== "string" || !data) return false;
  const id = String(keyId);
  const sequences = SPECIAL_KEYS[id];
  if (sequences) return sequences.includes(data);
  // Symbols and letters: a single literal character.
  return data === id;
}

export function truncateToWidth(text, width) {
  const value = String(text);
  const max = Number(width) || 0;
  return value.length <= max ? value : value.slice(0, Math.max(0, max));
}

export function visibleWidth(text) {
  return String(text).length;
}
