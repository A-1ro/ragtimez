import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { getSessionId, getSession } from "./lib/session";

/**
 * Global middleware that runs on every request.
 *
 * When a valid `session_id` cookie is present, it looks up the session in KV
 * and attaches the user's GitHub profile to `Astro.locals.user`.  All pages
 * and API routes can then check `Astro.locals.user` to determine whether the
 * visitor is authenticated.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (!env.AUTH_KV) {
    // AUTH_KV is not bound – sessions are unavailable.  This is expected
    // during local `astro dev` builds (no wrangler), but should not occur
    // in production.  Log a warning to aid diagnostics.
    console.warn(
      "[auth] AUTH_KV binding is not available; session loading skipped."
    );
    return next();
  }

  const sessionId = getSessionId(context.request);
  if (sessionId) {
    const user = await getSession(env.AUTH_KV, sessionId);
    if (user) {
      context.locals.user = user;
    }
  }
  return next();
});
