import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiUrl, buildRequestHeaders } from "./api";

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

/**
 * Live updates over SSE. Every server event maps to targeted query
 * invalidations so the UI is realtime without websockets infrastructure.
 * Uses fetch so the Supabase access token can be sent as Authorization.
 */
export function useRealtime(workspaceSlug: string) {
  const client = useQueryClient();
  const clientRef = useRef<QueryClient>(client);
  clientRef.current = client;

  useEffect(() => {
    let cancelled = false;
    let retry = 0;
    const abort = new AbortController();

    const connect = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(apiUrl("/api/v1/events"), {
            headers: buildRequestHeaders(),
            signal: abort.signal,
          });
          if (!res.ok || !res.body) throw new Error(`sse ${res.status}`);
          retry = 0;
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
              if (type !== "activity" || !data) continue;
              try {
                const parsed = JSON.parse(data) as { entityType: string; type: string };
                if (parsed.type === "presence") {
                  for (const fn of presenceListeners) {
                    fn(parsed as unknown as Parameters<PresenceListener>[0]);
                  }
                  continue;
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
                for (const keys of map[parsed.entityType] ?? []) {
                  for (const key of keys) {
                    void clientRef.current.invalidateQueries({ queryKey: [key] });
                  }
                }
              } catch {
                // ignore malformed frames
              }
            }
          }
        } catch (err) {
          if (cancelled || abort.signal.aborted) return;
          void err;
        }
        retry += 1;
        const wait = Math.min(15_000, 500 * 2 ** retry);
        await new Promise((r) => setTimeout(r, wait));
      }
    };

    void connect();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [workspaceSlug]);
}
