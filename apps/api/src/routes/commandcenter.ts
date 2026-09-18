import type { FastifyPluginAsync } from "fastify";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /** Adoption analytics, peer benchmarking and next-step recommendations. */
  app.get("/command-center", async (req) => core().commandCenter.commandCenter(core().ctx, req.session!));
};

export default routes;
