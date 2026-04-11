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
    /**
     * Internal API token used to authenticate calls to /api/generate-article
     * and /api/fetch-rss.
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
    /**
     * D1 database for storing user profiles and community notes.
     * Create with: wrangler d1 create ragtimez-notes
     */
    DB: D1Database;
    /**
     * KV namespace for storing newsletter subscribers.
     * Create with: wrangler kv namespace create SUBSCRIBERS_KV
     */
    SUBSCRIBERS_KV: KVNamespace;
    /**
     * Resend API key for sending emails.
     * Get your API key from https://resend.com/api-keys
     * Set via: wrangler pages secret put RESEND_API_KEY
     */
    RESEND_API_KEY: string;
    /**
     * Newsletter sender email address (must be verified in Resend).
     * Set via: wrangler pages secret put NEWSLETTER_FROM_EMAIL
     * Example: noreply@ragtimez.dev
     */
    NEWSLETTER_FROM_EMAIL: string;
    /**
     * Site URL for building unsubscribe links and article URLs.
     * Set via: wrangler pages secret put SITE_URL
     * Example: https://ragtimez.dev
     */
    SITE_URL: string;
  }
}

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  interface Locals extends Runtime {
    /** Populated by middleware when a valid session cookie is present. */
    user?: import("./lib/session").UserSession;
  }
}
