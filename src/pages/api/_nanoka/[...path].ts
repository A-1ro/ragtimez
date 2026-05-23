import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createNanokaApp } from "../../../server/nanoka-app";

export const ALL: APIRoute = async ({ request, locals }) => {
  return createNanokaApp(env).fetch(request, env, locals.cfContext);
};
