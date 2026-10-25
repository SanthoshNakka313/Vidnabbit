# VidNabbit web (apps/web)

Next.js 16 (App Router, TypeScript, Tailwind v4) frontend for VidNabbit. It talks directly to the FastAPI service (`services/api`) using the v1 contract in `docs/00-project-brief.md`.

## Run

```bash
npm install
cp .env.example .env.local     # optional; defaults are fine for local dev

npm run dev                    # http://localhost:3000, API at http://localhost:8000
npm run dev:mock               # in-browser fixtures, no backend needed
```

Environment (all public, inlined at build time):

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | API base URL (also added to CSP `connect-src`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` (Cloudflare test key) | Turnstile sitekey |
| `NEXT_PUBLIC_API_MOCK` | unset | `1` = use `src/lib/mock-api.ts` instead of the API |

## Mock scenarios (`NEXT_PUBLIC_API_MOCK=1`)

Paste any `https://` URL. Pick the scenario with the URL:

- `?mock=<error_code>` makes extract fail with that code, e.g. `https://example.com/v?mock=rate_limited`
- DRM hosts (`netflix.com`, `spotify.com`, ...) give `drm_protected`; paths containing `/private`, `/login`, `/live`, `/blocked`, `/too-long`, `/too-large`, `/rate-limit`, `/unsupported`, `/upstream`, `/not-found`, `/internal` give the matching error
- `?mock=extract_challenge`: extract requires a Turnstile token first
- `?mock=challenge_required`: the first job token is rejected
- `?mock=job_failed`: the job fails part-way
- `?mock=xss`: hostile title/thumbnail to check inert rendering
- paths with `audio`/`podcast` return audio; `photo`/`gallery`/`images` return images; anything else returns a video

## Checks

```bash
npm run lint
npm run typecheck              # next typegen && tsc --noEmit
npm test                       # Vitest unit tests
npx next build
npx playwright install chromium   # once
npm run test:e2e               # builds in mock mode and runs Playwright on :3100
```

## Layout

- `src/lib/api.ts`: typed client (`ApiError` with `code`), `src/lib/mock-api.ts` + `mock-fixtures.ts`: mock mode
- `src/lib/url.ts`: client-side URL validation (UX only; the API is authoritative)
- `src/lib/poll.ts`: job polling with backoff
- `src/lib/error-messages.ts`: friendly copy per error code (docs/04-design.md §2)
- `src/proxy.ts` + `src/lib/csp.ts`: per-request nonce CSP; other security headers in `next.config.ts`
- `src/components/downloader/*`: home page flow (URL form, result, formats, Turnstile, progress, done, errors)
- `src/app/globals.css`: tokens copied from `docs/design-tokens.css` (re-copy when that file changes)
