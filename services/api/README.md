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

Then run the web app (`npm run dev` in `apps/web`) and open http://localhost:3000. With Docker instead: `docker compose up --build` from the repo root (API, download worker, Redis and Postgres).

### Takedowns and the blocklist

- Without `DATABASE_URL` (local dev): takedown requests and the blocklist are JSON files under `DATA_DIR`.
- With `DATABASE_URL` (required in production): Postgres (`pg.py`, schema in `app/migrations/`, applied at startup). Each API instance and worker keeps the active blocklist in memory, refreshes it every `BLOCKLIST_REFRESH_SECONDS` and at once when a change is published on Redis. If Postgres can't be reached at startup the process refuses to start; if a later refresh fails, the last snapshot stays in force.
- A takedown request and its provisional URL blocks are written in one transaction. Requests (personal data) are deleted after `TAKEDOWN_RETENTION_DAYS` (default 3 years, **legal to confirm**) by a daily worker task; the blocks stay.
- Operator CLI, run on the host: `uv run python -m app.admin --help` (list and review takedowns, decide them, block or unblock URLs, `site media_id` items and verified domain exclusions, purge).

Run the Postgres tests against a throwaway database: `VN_TEST_DATABASE_URL=postgresql://... uv run pytest tests/test_pg.py` (they drop and recreate the schema).

### Job queue

- `QUEUE_BACKEND=inline` (default): downloads run inside the API process. Fine for local dev; one process only.
- `QUEUE_BACKEND=redis` (required in production): the API stores the job in Redis and enqueues it; workers run the download. Rate limits, the byte quota and extract results are kept in Redis too (`redis_state.py`), so several API instances enforce the same limits. All instances must share `IP_HASH_KEY_SEED` and `SIGNING_SECRET`. Start workers with `uv run arq app.worker.WorkerSettings`. Add workers to scale downloads; each runs `WORKER_CONCURRENCY` jobs at once. Workers finish running jobs for up to `WORKER_SHUTDOWN_GRACE_SECONDS` on shutdown.

Settings come from environment variables or `.env` (see `.env.example`). Every setting has a safe local default; `APP_ENV=production` refuses to start without real secrets, an egress proxy and a real Turnstile key.

## How a request flows

1. `POST /v1/extract`: rate limits → Turnstile (after 5 extracts in 10 min) → SSRF check (`ssrf.py`, every DNS answer must be public) → DRM denylist, kill switches and rights-holder blocklist (`policy.py`) → yt-dlp metadata extraction in a sandboxed child process (`sandbox.py` → `sandbox_runner.py` → `ytdlp_core.py`) → policy re-checked on the metadata → presets built (`extractor.py`).
2. `POST /v1/jobs`: Turnstile always → per-client and queue-depth caps → the job is queued (in process, or in Redis for a worker: `queue.py`, `worker.py`). The download (`jobs.perform_download`) re-extracts in a fresh child, re-checks policy, downloads, merges/converts with ffmpeg (local files only) and stores the file for at most 1 hour (`storage.py`).
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
| `jobs.py` | Shared download step, in-process job runner and janitor |
| `queue.py`, `worker.py` | Redis job records and caps; the arq download worker and sweeper |
| `redis_state.py` | Shared Redis connection, rate limiter (atomic Lua), byte quota, extract records |
| `pg.py`, `migrations/`, `admin.py` | Postgres takedowns and blocklist, schema migrations, operator CLI |
| `storage.py` | Local and R2 storage, signed tokens, safe filenames, expiry sweeps |
| `ratelimit.py`, `turnstile.py`, `takedown.py`, `cache.py`, `errors.py` | As named |

## R2 setup (owner, in the Cloudflare dashboard)

1. Create a **private** bucket (no public access, no custom domain), e.g. `vidnabbit-downloads`.
2. Add a lifecycle rule: delete objects with prefix `dl/` after 1 day. This is only a backstop; the app deletes files within minutes of their 1-hour expiry.
3. Create an R2 API token with **Object Read & Write** on that bucket only, and set the `R2_*` variables from `.env.example`.
4. For browsers to download directly, no CORS rule is needed (the link is a plain navigation, not a fetch).

## Not built yet

- Takedown email notifications to the operator (provider TBD); for now check `python -m app.admin takedowns --open`.
- Deleting live R2 files and queued jobs when a block is added (docs/03 7.2 A step 2). New downloads are refused at once; files already made expire within the hour.
- Extraction still runs in a sandbox child of the API process; docs/02 ADR-003 moves it to an `extract` worker queue.
- The egress proxy (Smokescreen) container and the infra in docs/02 section 8.
