"use client";

import { useState, type Ref } from "react";
import type { ExtractResponse } from "@/lib/api";
import { formatDuration, formatDurationLong } from "@/lib/format";
import { IconFilm, IconGlobe, IconImage, IconMusic } from "../icons";

interface MediaPreviewCardProps {
  data: ExtractResponse;
  titleRef: Ref<HTMLHeadingElement>;
}

const MEDIA_LABEL = { video: "Video", audio: "Audio", image: "Image", gallery: "Images" } as const;

/** Only absolute https: URLs are rendered (rejects javascript:, data:, http:). */
export function safeThumbnailUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Placeholder({ mediaType }: { mediaType: ExtractResponse["media_type"] }) {
  const Icon = mediaType === "audio" ? IconMusic : mediaType === "video" ? IconFilm : IconImage;
  return (
    <div className="flex h-full w-full items-center justify-center bg-brand-gradient text-white/90">
      <Icon size={40} />
    </div>
  );
}

export function SiteBadge({ site }: { site: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted">
      <IconGlobe size={14} />
      {site?.trim() || "Website"}
    </span>
  );
}

/**
 * Preview of what was found. All remote strings are rendered as React text
 * nodes (escaped), never as HTML. The thumbnail is a plain <img> with no
 * referrer so the source site doesn't learn where it was embedded.
 */
export function MediaPreviewCard({ data, titleRef }: MediaPreviewCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const duration = formatDuration(data.duration_seconds);
  const durationLong = formatDurationLong(data.duration_seconds);
  const thumbnail = safeThumbnailUrl(data.thumbnail_url);
  const showImage = !!thumbnail && !imgFailed;

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-center">
      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-surface-2 shadow-md md:w-72">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote, arbitrary hosts; must not be proxied through next/image
          <img
            src={thumbnail!}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            width={640}
            height={360}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Placeholder mediaType={data.media_type} />
        )}
        {duration && (
          <span className="tabular absolute bottom-2 right-2 rounded-full bg-ink/85 px-2 py-0.5 text-xs font-bold text-white">
            <span aria-hidden="true">{duration}</span>
            <span className="sr-only">Duration {durationLong}</span>
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2
          ref={titleRef}
          tabIndex={-1}
          title={data.title}
          data-testid="result-title"
          className="line-clamp-2 break-words text-xl sm:text-2xl"
        >
          {data.title || "Untitled"}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          {data.uploader && <span className="break-words">{data.uploader}</span>}
          {data.uploader && <span aria-hidden="true">·</span>}
          <SiteBadge site={data.source.site} />
          <span aria-hidden="true">·</span>
          <span>{MEDIA_LABEL[data.media_type] ?? "Media"}</span>
        </p>
      </div>
    </div>
  );
}
