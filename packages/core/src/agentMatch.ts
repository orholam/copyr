export type AgentCandidate = { id: string; name: string; description?: string | null };

const STOP = new Set(["agent", "the", "run", "company", "deal"]);

/** Reduce a word to a stem so "enrichment" and "enricher" can meet. */
function stem(word: string): string {
  return word.replace(/(ments|ment|ings|ing|ers|er|ed|es|s)$/, "");
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(stem)
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

/**
 * Pick the one workspace agent a loose name refers to.
 * Exact name wins. Otherwise a unique overlap of name and description stems.
 * Ambiguous or unknown queries return null so the caller can list the real agents.
 */
export function matchAgent(query: string, agents: AgentCandidate[]): AgentCandidate | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const exact = agents.find((agent) => agent.name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const wanted = tokens(trimmed);
  if (!wanted.length) return null;
  const scored = agents
    .map((agent) => {
      const hay = tokens(`${agent.name} ${agent.description ?? ""}`);
      const score = wanted.filter((token) => hay.some((word) => word.startsWith(token) || token.startsWith(word))).length;
      return { agent, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));

  if (!scored.length) return null;
  if (scored.length === 1 || scored[0]!.score > scored[1]!.score) return scored[0]!.agent;
  return null;
}
