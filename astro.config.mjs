// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? "http://localhost:4321",
  output: "server",
  adapter: cloudflare({
    // Disable remote binding proxy so local builds and CI work without
    // Cloudflare credentials.  In production (Cloudflare Pages), all
    // bindings declared in wrangler.toml are resolved natively.
    remoteBindings: false,
  }),
});
