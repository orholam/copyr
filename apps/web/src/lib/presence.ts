import { useEffect, useMemo, useRef, useState } from "react";
import { onPresence } from "./sse";
import { api } from "./api";

export interface Viewer {
  key: string;
  userId: string | null;
  name: string;
  ts: number;
}

const VIEWER_TTL_MS = 45_000;

function sessionKey(): string {
  let k = localStorage.getItem("copyr-presence-key");
  if (!k) {
    k = crypto.randomUUID();
    localStorage.setItem("copyr-presence-key", k);
  }
  return k;
}

/**
 * Live "who's looking at this" for a company/deal page.
 * Posts a viewing ping every 20s and merges presence events into an
 * ephemeral viewer list (TTL-based; nothing persisted server-side).
 */
export function usePresence(entityType: "company" | "deal", entityId: string) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const selfKey = useMemo(sessionKey, []);
  const viewersRef = useRef(viewers);
  viewersRef.current = viewers;

  useEffect(() => {
    if (!entityId) return;

    const merge = (v: Omit<Viewer, "ts"> & { ts?: number }) => {
      const now = Date.now();
      const next = [
        ...viewersRef.current.filter(
          (x) => x.key !== v.key && now - x.ts < VIEWER_TTL_MS,
        ),
        { ...v, ts: v.ts ?? now },
      ];
      setViewers(next);
    };

    const off = onPresence((msg) => {
      if (msg.entityType !== entityType || msg.entityId !== entityId) return;
      merge({
        key: `${msg.userId ?? msg.userName}-${msg.ts}`,
        userId: msg.userId,
        name: msg.userName,
        ts: new Date(msg.ts).getTime(),
      });
      // prune expired entries periodically
      setTimeout(() => {
        const now = Date.now();
        setViewers((cur) => cur.filter((x) => now - x.ts < VIEWER_TTL_MS));
      }, VIEWER_TTL_MS + 500);
    });

    // announce + heartbeat
    const storedName = localStorage.getItem("copyr-presence-name") ?? "You";
    void storedName;
    void api
      .post("/me")
      .then((ws: unknown) => {
        const members = (ws as { workspace?: { members?: Array<{ id: string; name: string }> } }).workspace?.members;
        void members;
      })
      .catch(() => undefined);

    const ping = () => {
      void api.post("/presence", { entityType, entityId, state: "viewing" }).catch(() => undefined);
    };
    ping();
    const iv = setInterval(ping, 15_000);

    return () => {
      clearInterval(iv);
      off();
    };
  }, [entityType, entityId]);

  /** Others currently viewing (excludes this tab via its own echo TTL). */
  const others = viewers.filter(
    (v) =>
      v.name !== "You" &&
      Date.now() - v.ts < VIEWER_TTL_MS,
  );
  return { viewers, others, selfKey };
}
