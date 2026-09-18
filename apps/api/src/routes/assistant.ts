import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sendMessageSchema } from "@copyr/contracts";
import { startHijackedSse } from "../sse-cors.js";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /** Thread history — every chat is reviewable. */
  app.get("/assistant/conversations", async (req) =>
    core().assistant.listConversations(core().ctx, req.session!),
  );

  app.post("/assistant/conversations", async (req) => {
    const body = z.object({ title: z.string().optional() }).parse(req.body ?? {});
    return core().assistant.createConversation(core().ctx, req.session!, body.title);
  });

  app.get("/assistant/conversations/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().assistant.getConversation(core().ctx, req.session!, id);
  });

  app.delete("/assistant/conversations/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await core().assistant.deleteConversation(core().ctx, req.session!, id);
    return { ok: true };
  });

  /** Streaming chat turn — SSE lifecycle events for the tool loop + reply. */
  app.post("/assistant/messages/stream", async (req, reply) => {
    const body = z
      .object({ conversationId: uuid.nullable().optional() })
      .extend(sendMessageSchema.shape)
      .parse(req.body ?? {});
    const host = (app as unknown as { assistantToolHost?: import("@copyr/core").AssistantToolHost })
      .assistantToolHost;

    const raw = startHijackedSse(req, reply);
    const send = (evt: Record<string, unknown> & { type: string }) => {
      raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    };
    try {
      const result = await core().assistant.streamMessage(
        core().ctx,
        req.session!,
        body.conversationId ?? null,
        body.content,
        host,
        send,
      );
      send({ type: "done", result });
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      raw.end();
    }
  });

  /** The central chat turn: persists the message and runs the tool loop. */
  app.post("/assistant/messages", async (req) => {
    const body = z
      .object({ conversationId: uuid.nullable().optional() })
      .extend(sendMessageSchema.shape)
      .parse(req.body ?? {});
    const host = (app as unknown as { assistantToolHost?: import("@copyr/core").AssistantToolHost })
      .assistantToolHost;
    return core().assistant.sendMessage(
      core().ctx,
      req.session!,
      body.conversationId ?? null,
      body.content,
      host,
    );
  });
};

export default routes;
