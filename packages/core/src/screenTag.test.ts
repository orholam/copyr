import { describe, it, expect } from "vitest";
import { formatScreenTag, stripScreenTags, upsertScreenTag } from "./screenTag.js";

describe("screenTag", () => {
  it("formats and upserts a single screen stamp", () => {
    expect(formatScreenTag("advance", 72.4)).toBe("screen:advance:72");
    const tags = upsertScreenTag(["climate", "screen:watch:40"], "advance", 81);
    expect(tags).toEqual(["climate", "screen:advance:81"]);
  });

  it("strips reserved screen tags", () => {
    expect(stripScreenTags(["a", "screen:pass:12", "b"])).toEqual(["a", "b"]);
  });
});
