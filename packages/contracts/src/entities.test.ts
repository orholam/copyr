import { describe, expect, it } from "vitest";
import { createDealInputSchema } from "./entities.js";

describe("createDealInputSchema", () => {
  it("rejects empty create_deal payloads", () => {
    const parsed = createDealInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("maps name onto companyName", () => {
    const parsed = createDealInputSchema.parse({ name: "OpenAI" });
    expect(parsed.companyName).toBe("OpenAI");
  });

  it("accepts companyId without a name", () => {
    const parsed = createDealInputSchema.parse({
      companyId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    });
    expect(parsed.companyId).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });
});
