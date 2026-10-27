<p align="center"><img src="brand/svg/vidnabbit-logo-horizontal.svg" alt="VidNabbit" width="420"></p>

<p align="center"><b>Paste it. Nab it.</b><br>A free media downloader and file converter.</p>

<p align="center"><a href="https://vidnabbit.com"><img alt="Live at vidnabbit.com" src="https://img.shields.io/website?url=https%3A%2F%2Fvidnabbit.com&up_message=live&down_message=down&label=vidnabbit.com&style=for-the-badge&color=F43F5E"></a></p>

<p align="center"><a href="https://vidnabbit.com"><b>vidnabbit.com</b></a> · <a href="https://vidnabbit.com/download">Downloader</a> · <a href="https://vidnabbit.com/convert/images">Image converter</a> · <a href="https://vidnabbit.com/convert/documents">Word &amp; PDF</a> · <a href="https://vidnabbit.com/supported-sites">Supported sites</a> · <a href="https://vidnabbit.com/faq">FAQ</a> · <a href="https://vidnabbit.com/copyright">Copyright &amp; takedown</a></p>

VidNabbit is a free website that downloads video, audio and images from **public** URLs using yt-dlp and ffmpeg. It is meant for media you own or have the right to download. These safeguards are non-negotiable:

- no DRM circumvention,
- no logins or cookies,
- a takedown blocklist,
- files deleted within 1 hour,
- rate limits,
- SSRF protection.

**🟢 Live at [vidnabbit.com](https://vidnabbit.com) since 27 October 2026.**

## What it does

The site has two tools:

- **VidNabbit** ([vidnabbit.com/download](https://vidnabbit.com/download)) downloads media from links (details below).
- **Convabbit** ([vidnabbit.com/convert/images](https://vidnabbit.com/convert/images)) converts files entirely in the browser, so nothing is uploaded:
  - images between JPG, PNG, WebP, AVIF, JPEG XL, GIF/APNG, TIFF, BMP, ICO, SVG and EPS (and opens HEIC, RAW/DNG and AI);
  - Word to PDF and PDF to Word;
  - images to PDF, PDF to images, and merging PDFs.

### Downloader

Paste a public link, pick a format (MP4 up to 4K, MP3, M4A or the original image), and download it. The file is deleted from our storage within 1 hour.

- **Works with** public pages on most video, audio and image sites that play without signing in, plus direct file links and archives such as the Internet Archive and Wikimedia Commons.
- **YouTube:** Creative Commons videos only.
- **Never:** DRM-protected services, anything behind a login or paywall, private or live content, or links removed at a rights holder's request.

Rights holders can ask for content to be blocked or a whole site excluded at [vidnabbit.com/copyright](https://vidnabbit.com/copyright). Contact: abuse@vidnabbit.com.

| Path | What |
|---|---|
| `apps/web` | Next.js 16 frontend ([README](apps/web/README.md)) |
| `services/api` | FastAPI + yt-dlp service and download workers ([README](services/api/README.md)) |
| `deploy/` | Production stack and launch runbook ([README](deploy/README.md)) |
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

## How it's deployed

- **Website:** Next.js on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare) (`npm run cf:deploy` in `apps/web`).
- **API and download workers:** one VM running Docker Compose: Caddy (accepts Cloudflare traffic only), the API, workers, Redis and Postgres on an internal network with no route out, and [Smokescreen](https://github.com/stripe/smokescreen) as the only way to the internet. Smokescreen refuses private, loopback, link-local and cloud-metadata addresses.
- **Files:** Cloudflare R2, deleted within 1 hour. **Bot check:** Cloudflare Turnstile.

See [`deploy/README.md`](deploy/README.md) for the step-by-step runbook and security checks.

## Private docs

The project brief, product brief, architecture, security and abuse, design and operations docs (`docs/0*.md`), the SEO plan and `CLAUDE.md` are kept in a separate private repository. Code comments that cite "docs/02 section …" refer to those docs.

Nothing in this repository is legal advice. Only download media you own or have permission to use; see the [Terms](https://vidnabbit.com/terms).
