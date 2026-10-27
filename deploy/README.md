# Launching VidNabbit

```
 visitor ──► Cloudflare ──► vidnabbit.com        Worker (Next.js via OpenNext)   apps/web
                  │
                  └──────► api.vidnabbit.com     Hetzner VM, this folder:
                                                  caddy ─► api ─┐
                                                                ├─ redis, postgres  (internal network,
                                                  worker ───────┘                    no route out)
                                                  api/worker ─► smokescreen ─► internet (public IPs only)
                                                  worker ─► R2 (via smokescreen) ─► presigned link ─► visitor
```

Files here:

| File | What |
|---|---|
| `docker-compose.prod.yml` | The API host: Caddy, Smokescreen, API, workers, Redis, Postgres, nightly backups |
| `smokescreen/` | Egress proxy image (pinned v0.1.0, checksum-verified), config and ACL |
| `caddy/Caddyfile` | TLS and reverse proxy; only accepts Cloudflare's IP ranges |
| `.env.example`, `gen-secrets.sh` | Production settings template and secret generator |
| `cloud-init.yaml` | First-boot hardening for the Hetzner server |

## 0. Before launch (owner)

- [ ] **Legal review** of the Terms, Privacy, Copyright pages and the guides (the site shows "Draft" banners until then).
- [x] **Domain:** `vidnabbit.com` is an active Cloudflare zone (no DNS records yet; SSL currently "Full").
- [ ] **Hetzner Cloud account** with an SSH key added. Read Hetzner's ToS/AUP and abuse process first (docs/02 section 11 item 1).
- [ ] An email address for TLS certificates and abuse contact.

## 1. Cloudflare (Claude can do these with the `cf` CLI; DNS needs the server IP first)

1. **Turnstile:** create a widget for `vidnabbit.com` (managed mode). The site key goes in the web build, the secret in `deploy/.env`.
2. **DNS:** `api` A (and AAAA) record to the server IP, **proxied** (orange cloud).
3. **SSL/TLS:** mode **Full (strict)**; Always Use HTTPS on; minimum TLS 1.2.
4. **WAF:** a rate-limiting rule on `api.vidnabbit.com/v1/extract` (e.g. 30 requests/min per IP) as a coarse layer in front of the API's own limits.
5. **R2:** the bucket `vidnabbit-downloads` and the scoped token already exist (see services/api/README.md).

## 2. API server (Hetzner)

1. Create a server: Ubuntu 24.04, an EU location, at least 4 vCPU / 8 GB (CX32 or CPX31). Paste `cloud-init.yaml` (with your SSH public key) into "Cloud config". Enable **Backups**.
2. Attach a **Hetzner Cloud Firewall** (this is the real control: Docker-published ports bypass `ufw`):
   - inbound TCP 22 from your own IP only;
   - inbound TCP 80 and 443 from Cloudflare's ranges only (https://www.cloudflare.com/ips);
   - everything else inbound denied.
3. On the server, as `deploy`:
   ```bash
   git clone https://github.com/SanthoshNakka313/Vidnabbit.git vidnabbit && cd vidnabbit/deploy
   cp .env.example .env && ./gen-secrets.sh >> .env && chmod 600 .env
   # fill in domains, ACME email, R2 keys and the Turnstile secret, then remove the empty duplicates
   docker compose -f docker-compose.prod.yml --env-file .env up -d --build
   docker compose -f docker-compose.prod.yml ps
   ```
4. **Verify the egress controls before announcing anything:**
   ```bash
   C="docker compose -f docker-compose.prod.yml exec -T api"
   # No direct route out: must fail.
   $C python -c "import urllib.request as u; u.urlopen('https://example.com', timeout=5)" && echo FAIL || echo ok
   # Through Smokescreen, a public site works:
   $C python -c "import urllib.request as u; o=u.build_opener(u.ProxyHandler({'https':'http://smokescreen:4750'})); print(o.open('https://example.com', timeout=10).status)"
   # Through Smokescreen, the metadata service and private ranges are refused:
   $C python -c "import urllib.request as u; o=u.build_opener(u.ProxyHandler({'http':'http://smokescreen:4750'})); o.open('http://169.254.169.254/', timeout=5)" && echo FAIL || echo ok
   $C python -c "import urllib.request as u; o=u.build_opener(u.ProxyHandler({'http':'http://smokescreen:4750'})); o.open('http://10.0.0.1/', timeout=5)" && echo FAIL || echo ok
   # Health through Cloudflare:
   curl -fsS https://api.vidnabbit.com/v1/health
   ```
5. Run a real download from the live site (an MP3 of a Creative Commons video), and a takedown test: `docker compose ... exec api python -m app.admin takedowns --open`.

## 3. Web app (Cloudflare Workers)

From `apps/web`, build with the production values (all public, none secret) and deploy:

```bash
NEXT_PUBLIC_SITE_URL=https://vidnabbit.com \
NEXT_PUBLIC_API_URL=https://api.vidnabbit.com \
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key> \
npm run cf:deploy
```

Then add the custom domains `vidnabbit.com` and `www.vidnabbit.com` to the `vidnabbit-web` Worker, and a redirect rule `www` → apex (301). The SSRF-relevant settings are in `wrangler.jsonc` (`global_fetch_strictly_public`).

## 4. After launch

- Submit `https://vidnabbit.com/sitemap.xml` in Google Search Console and Bing Webmaster Tools (the launch checklist is in the private SEO plan).
- Watch: `docker compose ... logs -f api worker smokescreen`, queue depth, R2 usage, Cloudflare analytics.
- Backups: `docker compose ... exec backup ls -l /backups` (nightly, 14 days) plus Hetzner Backups. Test a restore before you need one.
- Supported sites: every public site by default. To shut one off quickly, set `DISABLED_EXTRACTORS`
  or `DISABLED_DOMAINS` in `.env`; to allow only a list, set `ALLOWED_EXTRACTORS` (yt-dlp extractor
  keys). Then `up -d`.
- Updates: `git pull && docker compose -f docker-compose.prod.yml --env-file .env up -d --build`. Update yt-dlp regularly (`uv lock --upgrade-package yt-dlp` in services/api).

## Rollback

- Web: `npx wrangler rollback` in `apps/web` (previous Worker version).
- API: `git checkout <previous tag> && docker compose ... up -d --build`. Postgres migrations only add; restore from `/backups` if one ever has to be undone.
- Emergency stop of downloads: set `EXTRACTION_ENABLED=false` in `.env` and `up -d` (the site then says downloads are temporarily unavailable).
