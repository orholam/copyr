import type { FastifyPluginAsync } from "fastify";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /** One surface over both engines: codified agents + event workflows + merged runs. */
  app.get("/automations/overview", async (req) =>
    core().automations.overview(core().ctx, req.session!),
  );
};

export default routes;
