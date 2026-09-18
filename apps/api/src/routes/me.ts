import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getNotificationPrefs, updateNotificationPrefs } from "@copyr/core";

/** Identity/permission endpoints owned by the automation workstream.
 *  Kept separate from routes/workspace.ts to avoid write collisions
 *  with concurrent feature work. */
const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/me/permissions", async (req) => {
    const perms = await core().session.memberPermissions(core().ctx, req.session!);
    return { permissions: [...perms] };
  });

  app.get("/me/notification-prefs", async (req) => {
    return getNotificationPrefs(core().ctx, req.session!);
  });

  app.put("/me/notification-prefs", async (req) => {
    const input = z.record(z.string(), z.boolean()).parse(req.body);
    return updateNotificationPrefs(core().ctx, req.session!, input);
  });
};

export default routes;
