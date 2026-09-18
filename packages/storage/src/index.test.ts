import { describe, it, expect } from "vitest";
import { ObjectStore, getObjectStore } from "./index.js";
import { loadConfig } from "@copyr/config";

describe("ObjectStore.signedUrl", () => {
  it("produces a presigned GET url without contacting storage", async () => {
    const store = new ObjectStore();
    const url = await store.signedUrl("decks/test/deck.pdf", 120);
    expect(url).toContain("/decks/test/deck.pdf");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=120");
  });

  it("honors a custom bucket", async () => {
    const store = new ObjectStore({ bucket: "custom-bucket" });
    const url = await store.signedUrl("a/b.txt");
    expect(url).toContain("/custom-bucket/a/b.txt");
  });
});

describe("getObjectStore", () => {
  it("returns a shared default instance", () => {
    expect(getObjectStore()).toBe(getObjectStore());
    expect(getObjectStore()).toBeInstanceOf(ObjectStore);
  });
});

/* Round-trip tests need live S3-compatible storage (MinIO in dev). */
const reachable = await fetch(`${loadConfig().STORAGE_ENDPOINT}/minio/health/live`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!reachable)("ObjectStore round-trip (live MinIO)", () => {
  const store = new ObjectStore();

  it("puts and gets bytes intact", async () => {
    await store.ensureBucket();
    const body = Buffer.from(`copyr-test-${Date.now()}`);
    await store.put(`test/${body.toString()}.bin`, body, "application/octet-stream");
    await expect(store.get(`test/${body.toString()}.bin`)).resolves.toEqual(body);
    await store.delete(`test/${body.toString()}.bin`);
  });

  it("throws when reading a deleted or missing object", async () => {
    await expect(store.get(`test/does-not-exist-${Date.now()}.bin`)).rejects.toThrow();
  });
});
