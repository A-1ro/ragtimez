// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import remarkDirective from "remark-directive";
import { remarkAdminNote } from "./src/lib/remarkAdminNote.ts";

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? "http://localhost:4321",
  output: "server",
  markdown: {
    remarkPlugins: [remarkDirective, remarkAdminNote],
  },
  adapter: cloudflare({
    // Disable remote binding proxy so local builds and CI work without
    // Cloudflare credentials.  In production (Cloudflare Pages), all
    // bindings declared in wrangler.toml are resolved natively.
    remoteBindings: false,
  }),
});
