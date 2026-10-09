/** Turn a thesis completion into markdown, including models that return section fields instead of `memo`. */
export function composeThesisMemo(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.memo === "string" && row.memo.trim()) return row.memo.trim();

  const parts: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === "type" || key === "confidence" || key === "memo") continue;
    const text = sectionText(value);
    if (!text) continue;
    parts.push(`## ${key}\n\n${text}`);
  }
  return parts.length ? parts.join("\n\n") : null;
}

function sectionText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" && item.trim()) return `- ${item.trim()}`;
        if (item && typeof item === "object") return sectionText(item);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
