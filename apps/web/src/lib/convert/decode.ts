/**
 * Opens any supported image file into a Raster. The browser's own decoders
 * are tried first (fast, and Safari opens HEIC and JPEG XL natively); the
 * WebAssembly decoders in the worker cover everything else.
 */
import { detectInput, extOf } from "./formats";
import { ConvertError, MAX_FRAMES, checkSize, sourceToPixels, type Frame, type Raster } from "./raster";
import { decodeInWorker, decodeRaw } from "./workers";

export const MAX_IMAGE_BYTES = 100 * 1000 * 1000;

const CANT_OPEN = "This file couldn't be opened. It may be damaged or not really an image.";

/** Decodes with an <img>, which handles SVG and ICO too. First frame only. */
async function viaImg(file: Blob): Promise<Raster> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    let { naturalWidth: width, naturalHeight: height } = img;
    // SVGs without a size report 0 or 150; give them a useful default.
    if (file.type === "image/svg+xml" && (!width || !height)) [width, height] = [1024, 1024];
    checkSize(width, height);
    return { width, height, frames: [{ data: sourceToPixels(img, width, height), delay: 0 }] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type DecoderCtor = new (init: { data: ArrayBuffer; type: string }) => {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null };
  decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
};

/** Every frame of an animated GIF, APNG or WebP, using WebCodecs' ImageDecoder where the browser has it. */
async function viaImageDecoder(bytes: ArrayBuffer, type: string): Promise<Raster | null> {
  const ID = (globalThis as { ImageDecoder?: DecoderCtor & { isTypeSupported(t: string): Promise<boolean> } }).ImageDecoder;
  if (!ID || !(await ID.isTypeSupported(type).catch(() => false))) return null;
  const dec = new ID({ data: bytes, type });
  try {
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount < 2) return null;
    const count = Math.min(track.frameCount, MAX_FRAMES);
    const frames: Frame[] = [];
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      if (!width) {
        width = image.displayWidth;
        height = image.displayHeight;
        checkSize(width, height, count);
      }
      frames.push({ data: sourceToPixels(image, width, height), delay: (image.duration ?? 100_000) / 1000 });
      image.close();
    }
    return { width, height, frames };
  } catch {
    return null;
  } finally {
    dec.close();
  }
}

/** APNG frames without ImageDecoder (Safari), via UPNG. */
async function viaUpng(bytes: ArrayBuffer): Promise<Raster | null> {
  const UPNG = (await import("upng-js")).default;
  const img = UPNG.decode(bytes);
  if (!img.frames || img.frames.length < 2) return null;
  checkSize(img.width, img.height, img.frames.length);
  const rgba = UPNG.toRGBA8(img).slice(0, MAX_FRAMES);
  return {
    width: img.width,
    height: img.height,
    frames: rgba.map((buf, i) => ({ data: new Uint8ClampedArray(buf), delay: img.frames[i]?.delay ?? 100 })),
  };
}

const isApng = (b: Uint8Array) => {
  // An "acTL" chunk before the first "IDAT" marks an animated PNG.
  const s = String.fromCharCode(...b.subarray(0, Math.min(b.length, 4096)));
  const a = s.indexOf("acTL");
  return a > 0 && (s.indexOf("IDAT") === -1 || a < s.indexOf("IDAT"));
};

/** First page of a PDF or Illustrator (.ai) file, at up to 2400 px on the long side. */
async function viaPdf(bytes: Uint8Array): Promise<Raster> {
  const { renderFirstPage } = await import("./pdf");
  return renderFirstPage(bytes, 2400);
}

export async function decodeFile(file: File): Promise<Raster> {
  if (file.size > MAX_IMAGE_BYTES) throw new ConvertError("This file is over 100 MB.");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const kind = detectInput(bytes.subarray(0, 64), file.name);
  const ext = extOf(file.name);

  try {
    switch (kind) {
      case "eps":
        throw new ConvertError("EPS files can be created here but not opened. Open it in Illustrator, Inkscape or Preview and export a PNG first.");
      case "raw":
        return await decodeRaw(bytes.slice());
      case "pdf":
        return await viaPdf(bytes.slice());
      case "tiff":
        return await decodeInWorker("tiff", bytes.slice());
      case "avif":
      case "jxl":
      case "heic":
        // Native first (Safari: HEIC + JPEG XL; most browsers: AVIF), then WebAssembly.
        try {
          return await viaImg(new Blob([buffer], { type: `image/${kind}` }));
        } catch (e) {
          if (e instanceof ConvertError) throw e;
          return await decodeInWorker(kind, bytes.slice());
        }
      case "native": {
        const type =
          file.type ||
          ({ gif: "image/gif", png: "image/png", apng: "image/png", webp: "image/webp" } as Record<string, string>)[ext] ||
          "";
        if (["image/gif", "image/png", "image/apng", "image/webp"].includes(type)) {
          const animated =
            (await viaImageDecoder(buffer, type === "image/apng" ? "image/png" : type)) ??
            ((type === "image/png" || type === "image/apng") && isApng(bytes) ? await viaUpng(buffer) : null);
          if (animated) return animated;
        }
        try {
          return await viaImg(new Blob([buffer], { type: type || "application/octet-stream" }));
        } catch (e) {
          if (e instanceof ConvertError) throw e;
          // Older Safari can't show WebP; decode it ourselves.
          if (type === "image/webp" || ext === "webp") return await decodeInWorker("webp", bytes.slice());
          throw e;
        }
      }
    }
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError(kind === "raw" ? "This RAW file couldn't be read. Your camera model may not be supported yet." : CANT_OPEN);
  }
}
