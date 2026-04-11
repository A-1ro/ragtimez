// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://ragtimez.com",
  output: "server",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/api/"),
    }),
  ],
  adapter: cloudflare({
    // Disable remote binding proxy so local builds and CI work without
    // Cloudflare credentials.  In production (Cloudflare Pages), all
    // bindings declared in wrangler.toml are resolved natively.
    remoteBindings: false,
  }),
});
