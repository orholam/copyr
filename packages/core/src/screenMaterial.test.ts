import { describe, expect, it } from "vitest";
import { explainEnrichmentSkip, isPlaceholderCopy, thesisSkipReason, valuesEqual } from "./screenMaterial.js";

describe("screen material", () => {
  it("treats the IANA example page as a placeholder", () => {
    expect(isPlaceholderCopy("Example Domain\nThis domain is for use in illustrative examples in documents.")).toBe(
      true,
    );
  });

  it("explains a skipped enrichment in one sentence", () => {
    expect(explainEnrichmentSkip("example.com", "example.com is a placeholder page, not a company website")).toBe(
      "Couldn't enrich example.com — example.com is a placeholder page, not a company website.",
    );
    expect(explainEnrichmentSkip("example.com", "nothing to fill")).toBe(
      "example.com is already filled in. Parallel only writes empty fields, and it found nothing new to add.",
    );
    expect(explainEnrichmentSkip("example.com", "fetch timeout — no html")).toContain("didn't respond");
  });

  it("does not score a bare name and sector", () => {
    const skip = thesisSkipReason({ domain: "example.com", description: null, documentChars: 0 });
    expect(skip?.silent).toBe(true);
  });

  it("scores once a real description or deck exists", () => {
    expect(
      thesisSkipReason({
        domain: "acme.com",
        description: "Acme builds billing software for independent clinics across the US.",
        documentChars: 0,
      }),
    ).toBeNull();
    expect(thesisSkipReason({ domain: null, description: null, documentChars: 200 })).toBeNull();
  });

  it("says so when there is nothing at all to score", () => {
    const skip = thesisSkipReason({ domain: null, description: "AI/ML", documentChars: 0 });
    expect(skip?.silent).toBe(false);
    expect(skip?.reason).toMatch(/did not run/);
  });

  it("matches boolean workflow conditions stored as true or \"true\"", () => {
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual(true, "true")).toBe(true);
    expect(valuesEqual(false, "true")).toBe(false);
    expect(valuesEqual("advance", "advance")).toBe(true);
  });
});
