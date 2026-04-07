/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers / Pages runtime bindings.
 *
 * Augmenting `Cloudflare.Env` (from @cloudflare/workers-types) so that
 * `import { env } from "cloudflare:workers"` is fully type-checked throughout
 * the codebase.  The binding names must match wrangler.toml exactly.
 *
 * Types for AI and AiSearchInstance come from @cloudflare/workers-types.
 */
declare namespace Cloudflare {
  interface Env {
    /** Cloudflare Workers AI binding (LLM / embedding inference) */
    AI: Ai;
    /** Cloudflare AI Search binding (crawl-index queries) */
    AI_SEARCH: AiSearchInstance;
    /**
     * Internal API token used to authenticate calls to /api/search.
     * Set this as a secret in the Cloudflare Pages project settings:
     *   wrangler pages secret put INTERNAL_API_TOKEN
     */
    INTERNAL_API_TOKEN: string;
  }
}

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  interface Locals extends Runtime {}
}
