// Every page renders per request (CSP nonce in src/proxy.ts), so no incremental
// cache, tag cache or image optimisation binding is needed.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
