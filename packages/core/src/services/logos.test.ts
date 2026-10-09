import { describe, expect, it } from "vitest";
import { cdnLogoUrl, normalizeDomain, parseSearchHits } from "./logos.js";

describe("logo.dev helpers", () => {
  it("normalizes a website into a registrable host", () => {
    expect(normalizeDomain("https://www.Stripe.com/about")).toBe("stripe.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });

  it("builds a CDN url only when the publishable key is set", () => {
    const prev = process.env.LOGO_DEV_PUBLISHABLE_KEY;
    delete process.env.LOGO_DEV_PUBLISHABLE_KEY;
    expect(cdnLogoUrl("stripe.com")).toBeNull();
    process.env.LOGO_DEV_PUBLISHABLE_KEY = "pk_test";
    expect(cdnLogoUrl("stripe.com")).toContain("img.logo.dev/stripe.com");
    expect(cdnLogoUrl("stripe.com")).toContain("token=pk_test");
    if (prev === undefined) delete process.env.LOGO_DEV_PUBLISHABLE_KEY;
    else process.env.LOGO_DEV_PUBLISHABLE_KEY = prev;
  });

  it("reads the v2 search envelope", () => {
    process.env.LOGO_DEV_PUBLISHABLE_KEY = "pk_test";
    const hits = parseSearchHits({
      data: [{ object: "search_result", name: "Stripe", domain: "stripe.com", logo_url: "https://img.logo.dev/stripe.com?token=pk_test" }],
    });
    expect(hits).toEqual([
      { name: "Stripe", domain: "stripe.com", logoUrl: "https://img.logo.dev/stripe.com?token=pk_test" },
    ]);
  });
});
