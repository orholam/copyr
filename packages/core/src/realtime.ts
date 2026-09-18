import pg from "pg";

/**
 * Cross-instance realtime fan-out over Postgres LISTEN/NOTIFY.
 * NOTIFY inside a transaction is delivered on commit — so consumers never
 * see uncommitted events. Local single-instance apps get an EventEmitter;
 * multi-instance AWS deployments get correctness for free.
 */
export class RealtimeBus {
  /** Publishing pool — kept separate from the LISTEN client so publishers
   *  can never deadlock against the permanently-held listener connection. */
  private pool: pg.Pool;
  private connectionString: string;
  private listenClient: pg.Client | null = null;
  private listeners = new Set<(payload: string) => void>();
  private static CHANNEL = "copyr_events";
  private connecting: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.pool = new pg.Pool({ connectionString, max: 3 });
  }

  async publish(payload: unknown): Promise<void> {
    const json = JSON.stringify(payload);
    // Truncate guard: NOTIFY payloads max ~8000 bytes.
    await this.pool.query("select pg_notify($1, $2)", [
      RealtimeBus.CHANNEL,
      json.length > 7000 ? json.slice(0, 7000) : json,
    ]);
  }

  async subscribe(handler: (payload: string) => void): Promise<() => void> {
    this.listeners.add(handler);
    await this.ensureListener();
    return () => {
      this.listeners.delete(handler);
    };
  }

  private async ensureListener(): Promise<void> {
    if (this.listenClient) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new pg.Client({ connectionString: this.connectionString });
      const onErr = () => {
        this.listenClient = null;
        this.connecting = null;
        void client.end().catch(() => undefined);
      };
      client.on("notification", (msg) => {
        if (msg.channel === RealtimeBus.CHANNEL && msg.payload) {
          for (const fn of this.listeners) fn(msg.payload!);
        }
      });
      client.on("error", onErr);
      await client.connect();
      await client.query(`LISTEN ${RealtimeBus.CHANNEL}`);
      this.listenClient = client;
    })();
    return this.connecting;
  }

  async close(): Promise<void> {
    if (this.listenClient) await this.listenClient.end().catch(() => undefined);
    await this.pool.end();
  }
}
