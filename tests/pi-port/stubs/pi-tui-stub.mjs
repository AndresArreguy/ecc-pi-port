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
  handleInput() {}
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

export function matchesKey() {
  return false;
}

export function truncateToWidth(text, width) {
  const value = String(text);
  const max = Number(width) || 0;
  return value.length <= max ? value : value.slice(0, Math.max(0, max));
}

export function visibleWidth(text) {
  return String(text).length;
}
