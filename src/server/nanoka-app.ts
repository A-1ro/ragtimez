import { nanoka, d1Adapter } from "@nanokajs/core";
import type { Nanoka } from "@nanokajs/core";

export function createNanokaApp(env: Cloudflare.Env): Nanoka<{ Bindings: Cloudflare.Env }> {
  const app = nanoka<{ Bindings: Cloudflare.Env }>(d1Adapter(env.DB));

  app.get("/api/nanoka/health", (c) => {
    return c.json({ status: "ok", time: new Date().toISOString(), runtime: "nanoka" });
  });

  return app;
}
