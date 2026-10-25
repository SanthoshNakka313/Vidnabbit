import { describe, expect, it } from "vitest";
import { videoExtractFixture } from "./mock-fixtures";
import { defaultFormatId, formatBytes, formatDuration, formatSize, groupFormats, recommendedFormatIds } from "./format";

describe("format helpers", () => {
  const formats = videoExtractFixture("https://e.com").formats;

  it("groups video, audio, images in order", () => {
    expect(groupFormats(formats).map((g) => g.kind)).toEqual(["video", "audio"]);
  });

  it("recommends 1080p MP4 and MP3, and preselects the video", () => {
    const ids = recommendedFormatIds(formats);
    expect(ids).toEqual(new Set(["preset-1080p", "preset-audio-mp3-192"]));
    expect(defaultFormatId(formats)).toBe("preset-1080p");
  });

  it("formats sizes and durations", () => {
    expect(formatBytes(123_456_789)).toBe("123 MB");
    expect(formatSize({ filesize_bytes: 141_600_000, filesize_is_estimate: true })).toBe("~142 MB");
    expect(formatSize({ filesize_bytes: null, filesize_is_estimate: false })).toBe("Size unknown");
    expect(formatDuration(213)).toBe("3:33");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});
