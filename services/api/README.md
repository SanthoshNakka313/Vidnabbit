# VidNabbit API (services/api)

FastAPI + yt-dlp + ffmpeg. Implements the v1 contract in `docs/00-project-brief.md`; the safeguards are specified in `docs/03-security-and-abuse.md`.

## Run locally

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/). ffmpeg is optional: the dev dependencies include a static binary (`imageio-ffmpeg`), which is used when `ffmpeg` is not on `PATH`.

```bash
uv sync                                   # creates .venv with dev dependencies
uv run uvicorn app.main:create_app --factory --reload --port 8000
uv run pytest                             # unit tests, no network
uv run pytest -m network                  # live smoke tests (hit real sites)
uv run ruff check .
```

Then run the web app (`npm run dev` in `apps/web`) and open http://localhost:3000. With Docker instead: `docker compose up --build` from the repo root.

Settings come from environment variables or `.env` (see `.env.example`). Every setting has a safe local default; `APP_ENV=production` refuses to start without real secrets, an egress proxy and a real Turnstile key.

## How a request flows

1. `POST /v1/extract`: rate limits → Turnstile (after 5 extracts in 10 min) → SSRF check (`ssrf.py`, every DNS answer must be public) → DRM denylist, kill switches and rights-holder blocklist (`policy.py`) → yt-dlp metadata extraction in a sandboxed child process (`sandbox.py` → `sandbox_runner.py` → `ytdlp_core.py`) → policy re-checked on the metadata → presets built (`extractor.py`).
2. `POST /v1/jobs`: Turnstile always → the job runner (`jobs.py`) re-extracts in a fresh child, re-checks policy, downloads, merges/converts with ffmpeg (local files only) and stores the file for at most 1 hour (`storage.py`).
3. `GET /v1/jobs/{id}` is polled for progress. The file is served by a presigned R2 URL that expires with the file (`STORAGE_BACKEND=r2`), or locally by `GET /v1/files/{token}` with an HMAC-signed, expiring token.

Inside the child, every connection yt-dlp opens (redirects, CDN and HLS/DASH segment URLs) is SSRF-checked at connect time on the resolved address. In production an egress proxy is the authoritative control (docs/02 ADR-004).

## Layout

| Module | Role |
|---|---|
| `main.py` | App factory, routes, request guard middleware |
| `config.py` | Settings and production config checks |
| `ssrf.py` | URL normalisation, IP range checks, yt-dlp connection guard |
| `policy.py` | DRM denylist, blocklist, kill switches, duration/size limits |
| `extractor.py` | Presets and the async facade over the sandbox |
| `ytdlp_core.py` | The only yt-dlp option builder; runs inside the child |
| `sandbox.py`, `sandbox_runner.py` | Child process with rlimits, scrubbed env, JSON-lines protocol |
| `jobs.py` | In-memory job queue and janitor (Redis + arq in production) |
| `storage.py` | Local and R2 storage, signed tokens, safe filenames, expiry sweeps |
| `ratelimit.py`, `turnstile.py`, `takedown.py`, `cache.py`, `errors.py` | As named |

## R2 setup (owner, in the Cloudflare dashboard)

1. Create a **private** bucket (no public access, no custom domain), e.g. `vidnabbit-downloads`.
2. Add a lifecycle rule: delete objects with prefix `dl/` after 1 day. This is only a backstop; the app deletes files within minutes of their 1-hour expiry.
3. Create an R2 API token with **Object Read & Write** on that bucket only, and set the `R2_*` variables from `.env.example`.
4. For browsers to download directly, no CORS rule is needed (the link is a plain navigation, not a fetch).

## Not built yet

- The Redis/arq queue: jobs run in-process, so the API is a single instance for now.
- Postgres for takedowns and the blocklist (they are JSON files under `DATA_DIR` for now).
- The egress proxy (Smokescreen) container and the infra in docs/02 section 8.
