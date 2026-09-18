/** Thin typed API client for the Copyr REST API. */
const BASE = "/api/v1";
export const WORKSPACE_SLUG =
  (import.meta.env.VITE_WORKSPACE_SLUG as string | undefined) ?? "harbor-ventures";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, body: { error: string; code?: string; details?: unknown }) {
    super(body.error);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-workspace-slug": WORKSPACE_SLUG,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(p: string) => request<T>(p, { method: "DELETE" }),

  /** POST that reads an SSE stream; emits parsed `{ type, ... }` frames. */
  async stream(
    path: string,
    body: unknown,
    onEvent: (evt: Record<string, unknown> & { type: string }) => void,
  ) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-slug": WORKSPACE_SLUG,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok || !res.body) {
      const b = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, b);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let type = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) type = line.slice(7).trim();
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        try {
          onEvent({ ...JSON.parse(data), type });
        } catch {
          /* ignore malformed keep-alive frames */
        }
      }
    }
  },

  async upload(path: string, files: File[], params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
      method: "POST",
      body: fd,
      headers: { "x-workspace-slug": WORKSPACE_SLUG },
    });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({ error: "upload failed" })));
    return res.json() as Promise<unknown>;
  },
};
