<p align="center"><img src="brand/svg/vidnabbit-logo-horizontal.svg" alt="VidNabbit" width="420"></p>

<p align="center"><b>Paste it. Nab it.</b><br>A fast, friendly downloader for videos, images and audio.</p>

VidNabbit is a free website that downloads video, audio and images from **public** URLs using yt-dlp and ffmpeg. It is meant for media you own or have the right to download. These safeguards are non-negotiable:

- no DRM circumvention,
- no logins or cookies,
- a takedown blocklist,
- files deleted within 1 hour,
- rate limits,
- SSRF protection.

| Path | What |
|---|---|
| `apps/web` | Next.js 16 frontend ([README](apps/web/README.md)) |
| `services/api` | FastAPI + yt-dlp service and download workers ([README](services/api/README.md)) |
| [`BRAND.md`](BRAND.md), `brand/` | Brand rules, logos and icons. Read `BRAND.md` before any UI work; never redraw the logo. |
| `docs/design-tokens.css` | Design tokens used by the web app |

## Brand at a glance

- **Colours:** Nabbit Rose `#F43F5E` · Coral `#FF4D6D` · Violet `#7C3AED` · Sun `#FFD166` · Ink `#1E1B2E`
- **Gradient:** `linear-gradient(135deg, #FF4D6D, #7C3AED)`
- **Font:** [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License)
- Visual guide: open `brand/brand-guide.html` in a browser.

## Local dev

```bash
# terminal 1
cd services/api && uv sync && uv run uvicorn app.main:create_app --factory --reload --port 8000
# terminal 2
cd apps/web && npm install && npm run dev
```

Open http://localhost:3000. To work on the UI without the backend, run `npm run dev:mock` instead. With Docker: `docker compose up --build` (API, download worker, Redis and Postgres).

## Private docs

The project brief, product brief, architecture, security and abuse, and design docs (`docs/0*.md`) and `CLAUDE.md` are kept in a separate private repository. Code comments that cite "docs/02 section …" refer to those docs.

Not legal advice: the owner gets legal review before any public launch.
