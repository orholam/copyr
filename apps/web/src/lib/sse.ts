import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiHeaders, apiUrl } from "./api";

type PresenceListener = (msg: {
  userId: string | null;
  userName: string;
  entityType: string;
  entityId: string;
  state: "viewing" | "leave";
  ts: string;
}) => void;

const presenceListeners = new Set<PresenceListener>();

/** Subscribe to live viewer presence across the app. */
export function onPresence(fn: PresenceListener): () => void {
  presenceListeners.add(fn);
  return () => {
    presenceListeners.delete(fn);
  };
}

function dispatchActivity(client: QueryClient, data: { entityType: string; type: string }) {
  if (data.type === "presence") {
    for (const fn of presenceListeners) {
      fn(data as unknown as Parameters<PresenceListener>[0]);
    }
    return;
  }
  const map: Record<string, string[][]> = {
    deal: [["deals"], ["deal"]],
    company: [["companies"], ["company"]],
    email: [["emails"]],
    document: [["documents"]],
    note: [["notes"]],
    portfolio_update: [["portfolio"]],
    stage: [["pipelines"]],
    activity: [["activity"]],
  };
  for (const keys of map[data.entityType] ?? []) {
    for (const key of keys) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  }
}

/**
 * Live updates over fetch-based SSE so we can send Authorization: Bearer.
 * EventSource cannot set headers; tokens must not go on the query string.
 */
export function useRealtime(workspaceSlug: string) {
  const client = useQueryClient();
  const clientRef = useRef<QueryClient>(client);
  clientRef.current = client;

  useEffect(() => {
    const abort = new AbortController();
    let retryMs = 1_000;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        abort.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });

    const consume = async (res: Response) => {
      if (!res.body) return;
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
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          try {
            dispatchActivity(clientRef.current, JSON.parse(data) as { entityType: string; type: string });
          } catch {
            /* ignore keep-alive / ready frames */
          }
        }
      }
    };

    const run = async () => {
      while (!abort.signal.aborted) {
        try {
          const headers = await apiHeaders({ accept: "text/event-stream" });
          const res = await fetch(apiUrl("/api/v1/events"), { headers, signal: abort.signal });
          if (!res.ok || !res.body) throw new Error(`sse ${res.status}`);
          retryMs = 1_000;
          await consume(res);
        } catch {
          if (abort.signal.aborted) return;
          await sleep(retryMs);
          retryMs = Math.min(retryMs * 2, 15_000);
        }
      }
    };
    void run();
    return () => abort.abort();
  }, [workspaceSlug]);
}
