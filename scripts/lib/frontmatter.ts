export interface Frontmatter {
  /** Raw YAML block without `---` delimiters. */
  raw: string;
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { raw: "", data: {}, body: normalized };
  }
  const raw = match[1];
  const data: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (/^\s/.test(line)) continue; // nested YAML values are kept in `raw` only
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { raw, data, body: normalized.slice(match[0].length) };
}

export function serializeFrontmatter(data: Record<string, string>): string {
  const order = ["description", "argument-hint"];
  const keys = [...new Set([...order.filter((k) => data[k] != null), ...Object.keys(data).filter((k) => data[k] != null)])];
  if (keys.length === 0) return "";
  const lines = keys.map((key) => {
    const value = data[key] ?? "";
    const needsQuotes =
      /[:#\n]/.test(value) || value.includes('"') || value.startsWith("[") || value.startsWith("{");
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${key}: ${needsQuotes ? `"${escaped}"` : value}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Renames the `name:` field inside the first frontmatter block. */
export function renameFrontmatterName(content: string, newName: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return normalized;
  const raw = match[1].replace(/^name:\s*.*$/m, `name: ${newName}`);
  return normalized.replace(match[0], `---\n${raw}\n---`);
}
