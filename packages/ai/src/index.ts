import { loadConfig } from "@copyr/config";
import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import { withContractEnforcement } from "./normalize.js";
import type { AiProvider } from "./types.js";

export * from "./types.js";
/** Re-exported so tests can wire a deterministic provider without deep imports. */
export { MockProvider };

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (provider) return provider;
  const cfg = loadConfig();
  const raw =
    cfg.AI_PROVIDER === "openai" ? new OpenAiCompatibleProvider() : new MockProvider();
  // Every provider response is normalized to the documented contract shapes.
  provider = withContractEnforcement(raw);
  return provider;
}

/** Test helper. */
export function setAiProvider(p: AiProvider | undefined): void {
  provider = p ? withContractEnforcement(p) : undefined;
}
