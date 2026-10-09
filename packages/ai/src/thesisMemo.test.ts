import { describe, expect, it } from "vitest";
import { composeThesisMemo } from "./thesisMemo.js";

describe("composeThesisMemo", () => {
  it("keeps a memo string", () => {
    expect(composeThesisMemo({ memo: "  # Acme  ", confidence: 0.4 })).toBe("# Acme");
  });

  it("builds markdown from section fields", () => {
    expect(
      composeThesisMemo({
        type: "object",
        "What they do": "DeepGraph builds a context layer.",
        "Key risks": ["Thin diligence", "Crowded market"],
      }),
    ).toBe(
      ["## What they do", "", "DeepGraph builds a context layer.", "", "## Key risks", "", "- Thin diligence", "- Crowded market"].join(
        "\n",
      ),
    );
  });
});
