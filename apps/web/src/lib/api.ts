/** Thin typed API client for the Copyr REST API. */

import { getAccessToken, isAuthRequired } from "./supabase";

/** Absolute API origin in split deploys (Vercel web + Render API). Empty = same origin. */
export function apiUrl(path: string): string {
  const origin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

const BASE = apiUrl("/api/v1");
const WS_STORAGE_KEY = "copyr-workspace-slug";

export const WORKSPACE_SLUG =
  (import.meta.env.VITE_WORKSPACE_SLUG as string | undefined) ?? "harbor-ventures";

export function getWorkspaceSlug(): string | undefined {
  try {
    const stored = localStorage.getItem(WS_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* private mode */
  }
  const fromEnv = import.meta.env.VITE_WORKSPACE_SLUG as string | undefined;
  if (fromEnv) return fromEnv;
  if (!isAuthRequired()) return WORKSPACE_SLUG;
  return undefined;
}

export function rememberWorkspaceSlug(slug: string): void {
  try {
    localStorage.setItem(WS_STORAGE_KEY, slug);
  } catch {
    /* ignore */
  }
}

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

export async function apiHeaders(init?: HeadersInit): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const slug = getWorkspaceSlug();
  if (slug) headers["x-workspace-slug"] = slug;
  if (init) {
    const extra = new Headers(init);
    extra.forEach((value, key) => {
      headers[key] = value;
    });
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await apiHeaders(init?.headers);
  if (init?.body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (res.status === 401 && headers.Authorization) {
    window.dispatchEvent(new Event("copyr:auth-expired"));
  }
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
    const headers = await apiHeaders({ "content-type": "application/json" });
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
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
    const headers = await apiHeaders();
    const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
      method: "POST",
      body: fd,
      headers,
    });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({ error: "upload failed" })));
    return res.json() as Promise<unknown>;
  },
};
