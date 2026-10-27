import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Remote strings must never be rendered as HTML (docs/03 W5).
    rules: { "react/no-danger": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Cloudflare build output (OpenNext / wrangler).
    ".open-next/**",
    ".wrangler/**",
    // Third-party files copied from node_modules (PDF.js worker and data).
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
