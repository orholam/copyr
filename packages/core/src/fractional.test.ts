import { describe, it, expect } from "vitest";
import { generateKeyBetween, initialKey } from "./fractional.js";

describe("initialKey", () => {
  it("returns the canonical first position", () => {
    expect(initialKey()).toBe("a0");
  });
});

describe("generateKeyBetween", () => {
  it("generates a key strictly between two keys", () => {
    const mid = generateKeyBetween("a0", "a1");
    expect(mid > "a0").toBe(true);
    expect(mid < "a1").toBe(true);
  });

  it("appends after the last key when end is null", () => {
    const next = generateKeyBetween("a0", null);
    expect(next > "a0").toBe(true);
  });

  it("prepends before the first key when start is null", () => {
    const prev = generateKeyBetween(null, "a0");
    expect(prev < "a0").toBe(true);
  });

  it("supports repeated insertion at the head while staying sorted", () => {
    let first = "a0";
    for (let i = 0; i < 5; i++) {
      first = generateKeyBetween(null, first);
      expect(first < "a0").toBe(true);
    }
  });

  it("produces lexicographically increasing keys for sequential appends", () => {
    let cursor: string | null = initialKey();
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      cursor = generateKeyBetween(cursor, null);
      keys.push(cursor);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});
