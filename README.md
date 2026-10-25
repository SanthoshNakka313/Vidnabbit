# VidNabbit

A free website that downloads video, audio and images from **public** URLs using yt-dlp and ffmpeg, with non-negotiable safeguards: no DRM circumvention, no logins or cookies, a takedown blocklist, files deleted within 1 hour, rate limits and SSRF protection.

Start with `docs/00-project-brief.md` (decisions, safeguards, API contract).

| Path | What |
|---|---|
| `apps/web` | Next.js 16 frontend ([README](apps/web/README.md)) |
| `services/api` | FastAPI + yt-dlp service ([README](services/api/README.md)) |
| `docs/` | Brief, product, architecture, security and abuse, design |

## Local dev

```bash
# terminal 1
cd services/api && uv sync && uv run uvicorn app.main:create_app --factory --reload --port 8000
# terminal 2
cd apps/web && npm install && npm run dev
```

Open http://localhost:3000. To work on the UI without the backend, run `npm run dev:mock` instead.

Not legal advice: the owner gets legal review before any public launch.
