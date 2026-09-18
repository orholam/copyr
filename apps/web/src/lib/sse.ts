import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

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
 */
export function useRealtime(workspaceSlug: string) {
  const client = useQueryClient();
  const clientRef = useRef<QueryClient>(client);
  clientRef.current = client;

  useEffect(() => {
    const es = new EventSource(`/api/v1/events`, { withCredentials: false });
    // workspace slug rides the default dev session; events are filtered server-side

    es.addEventListener("activity", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          entityType: string;
          type: string;
        };
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
            void clientRef.current.invalidateQueries({ queryKey: [key] });
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    return () => es.close();
  }, [workspaceSlug]);
}
