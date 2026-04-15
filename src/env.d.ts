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
    /**
     * Comma-separated list of GitHub numeric user IDs allowed to access
     * /admin/quality via browser session (GitHub OAuth).
     *
     * Optional — when unset, browser session auth is disabled and only the
     * Bearer token (INTERNAL_API_TOKEN) grants access.
     *
     * Set via: wrangler pages secret put ADMIN_GITHUB_IDS
     * Example value: "12345,67890"
     */
    ADMIN_GITHUB_IDS?: string;
    /**
     * Bluesky handle for publishing articles.
     * Optional — when unset, Bluesky posting is skipped.
     *
     * Set via: wrangler pages secret put BLUESKY_IDENTIFIER
     * Example value: "ragtimez.bsky.social"
     */
    BLUESKY_IDENTIFIER?: string;
    /**
     * Bluesky App Password for authentication.
     * Generate at https://bsky.app/settings/app-passwords
     * Optional — when unset, Bluesky posting is skipped.
     *
     * Set via: wrangler pages secret put BLUESKY_APP_PASSWORD
     */
    BLUESKY_APP_PASSWORD?: string;
    /**
     * Tavily API key for web search and content extraction.
     * Used by /api/generate-article to fetch full article body text for RAG context.
     * Optional — when unset, article generation falls back to RSS summaries only.
     *
     * Get your API key from https://app.tavily.com
     * Set via: wrangler pages secret put TAVILY_API_KEY
     */
    TAVILY_API_KEY?: string;
    /**
     * Anthropic API key for high-quality draft generation using Claude (claude-sonnet-4).
     * Used by /api/generate-article as the primary draft model; falls back to CF Workers AI when unset.
     * Optional — when unset, article generation uses CF Workers AI (DRAFT_FALLBACK_MODEL) directly.
     *
     * Get your API key from https://console.anthropic.com/settings/keys
     * Set via: wrangler pages secret put ANTHROPIC_API_KEY
     */
    ANTHROPIC_API_KEY?: string;
  }
}

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  interface Locals extends Runtime {
    /** Populated by middleware when a valid session cookie is present. */
    user?: import("./lib/session").UserSession;
    /**
     * True when the logged-in user's GitHub ID appears in the
     * ADMIN_GITHUB_IDS environment variable.  Always false when the user is
     * not logged in or when ADMIN_GITHUB_IDS is unset.
     * Set by src/middleware.ts on every request.
     */
    isAdmin?: boolean;
  }
}
