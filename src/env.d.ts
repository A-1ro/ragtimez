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
    /**
     * GitHub OAuth App client ID.
     * Set via: wrangler pages secret put GITHUB_CLIENT_ID
     */
    GITHUB_CLIENT_ID: string;
    /**
     * GitHub OAuth App client secret.
     * Set via: wrangler pages secret put GITHUB_CLIENT_SECRET
     */
    GITHUB_CLIENT_SECRET: string;
    /**
     * KV namespace for storing user sessions and OAuth state.
     * Create with: wrangler kv namespace create AUTH_KV
     */
    AUTH_KV: KVNamespace;
  }
}

type Runtime = import("@astrojs/cloudflare").Runtime;

/** Authenticated GitHub user stored in the session. */
interface SessionUser {
  login: string;
  avatarUrl: string;
}

declare namespace App {
  interface Locals extends Runtime {
    /** Populated by middleware when a valid session cookie is present. */
    user?: SessionUser;
  }
}
