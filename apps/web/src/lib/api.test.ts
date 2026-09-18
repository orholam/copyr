import { describe, it, expect, beforeEach } from "vitest";
import { apiUrl, buildRequestHeaders, setAccessToken, setWorkspaceSlug } from "./api";

describe("apiUrl", () => {
  it("keeps same-origin paths when VITE_API_URL is unset", () => {
    expect(apiUrl("/api/v1/events")).toBe("/api/v1/events");
    expect(apiUrl("api/v1/health")).toBe("/api/v1/health");
  });
});

describe("buildRequestHeaders", () => {
  beforeEach(() => {
    setAccessToken(null);
    setWorkspaceSlug(null);
  });

  it("sends Authorization: Bearer when a session token is present", () => {
    setAccessToken("supa-access-token");
    expect(buildRequestHeaders()).toMatchObject({
      authorization: "Bearer supa-access-token",
    });
  });

  it("does not send the demo workspace slug together with a bearer token", () => {
    setAccessToken("supa-access-token");
    const headers = buildRequestHeaders();
    expect(headers["x-workspace-slug"]).toBeUndefined();
  });

  it("sends an explicit workspace slug with the bearer token when selected", () => {
    setAccessToken("supa-access-token");
    setWorkspaceSlug("northwind-capital");
    expect(buildRequestHeaders()["x-workspace-slug"]).toBe("northwind-capital");
  });
});
