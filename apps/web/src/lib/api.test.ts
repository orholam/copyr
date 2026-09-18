import { describe, it, expect } from "vitest";
import { apiUrl } from "./api";

describe("apiUrl", () => {
  it("keeps same-origin paths when VITE_API_URL is unset", () => {
    expect(apiUrl("/api/v1/events")).toBe("/api/v1/events");
    expect(apiUrl("api/v1/health")).toBe("/api/v1/health");
  });
});
