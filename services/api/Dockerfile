# VidNabbit API image (docs/02 section 3: non-root, distro ffmpeg, pinned yt-dlp).
# Run it read-only with /work as the only writable volume; see docker-compose.yml.

FROM python:3.12-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra queue

FROM python:3.12-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin vidnabbit \
    && mkdir /work && chown 10001:10001 /work
COPY --from=build /opt/venv /opt/venv
COPY app /srv/app
ENV PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    APP_ENV=production DATA_DIR=/work
WORKDIR /srv
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["python", "-c", \
    "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/v1/health', timeout=4)"]
# tini reaps orphaned ffmpeg/yt-dlp grandchildren.
ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--no-access-log"]
