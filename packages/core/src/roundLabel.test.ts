import { describe, expect, it } from "vitest";
import { parseRoundLabel } from "./roundLabel.js";

describe("parseRoundLabel", () => {
  it("parses a plain amount", () => {
    expect(parseRoundLabel("$2m")).toEqual({ roundStage: null, askAmount: 2_000_000, valuation: null });
    expect(parseRoundLabel("$7M").askAmount).toBe(7_000_000);
  });

  it("parses stage plus a single amount", () => {
    expect(parseRoundLabel("$6M Seed")).toEqual({
      roundStage: "Seed",
      askAmount: 6_000_000,
      valuation: null,
    });
    expect(parseRoundLabel("12M Series A")).toMatchObject({ roundStage: "Series A", askAmount: 12_000_000 });
    expect(parseRoundLabel("$5m Series B").roundStage).toBe("Series B");
    expect(parseRoundLabel("4.5M seed ext")).toMatchObject({ roundStage: "Seed", askAmount: 4_500_000 });
    expect(parseRoundLabel("$5M Seed/SAFE").roundStage).toBe("Seed");
    expect(parseRoundLabel("5m seed extension").askAmount).toBe(5_000_000);
  });

  it("keeps SAFE with no stage and still reads the check size", () => {
    expect(parseRoundLabel("$1.3M SAFE")).toEqual({
      roundStage: null,
      askAmount: 1_300_000,
      valuation: null,
    });
  });

  it("splits post-money from the ask", () => {
    expect(parseRoundLabel("$2M Seed on $20M Post")).toEqual({
      roundStage: "Seed",
      askAmount: 2_000_000,
      valuation: 20_000_000,
    });
  });

  it("does not invent an ask for ranges, notes, or empty rounds", () => {
    expect(parseRoundLabel("$6-$10M Series A")).toEqual({
      roundStage: "Series A",
      askAmount: null,
      valuation: null,
    });
    expect(parseRoundLabel("$10-20M Seed Round").askAmount).toBeNull();
    expect(parseRoundLabel("$2-3M Seed").askAmount).toBeNull();
    expect(parseRoundLabel("Note Extension before $8M Series A")).toEqual({
      roundStage: null,
      askAmount: null,
      valuation: null,
    });
    expect(parseRoundLabel("Series C (2027)")).toEqual({
      roundStage: "Series C",
      askAmount: null,
      valuation: null,
    });
    expect(parseRoundLabel("N/A")).toEqual({ roundStage: null, askAmount: null, valuation: null });
  });

  it("uses the current check when a later round is mentioned", () => {
    expect(parseRoundLabel("4m pre-seed, followed by 26m to reach ocean MVP")).toEqual({
      roundStage: "Pre-seed",
      askAmount: 4_000_000,
      valuation: null,
    });
  });
});
