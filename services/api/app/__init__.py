"""VidNabbit API package."""

import os

# Never load yt-dlp plugins (docs/03 2.2). Must run before yt_dlp is imported.
os.environ.setdefault("YTDLP_NO_PLUGINS", "1")
