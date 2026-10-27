/**
 * The converter's in-memory picture: RGBA pixels, one entry per frame (one
 * for still images). Decoders produce it, encoders consume it.
 */

export interface Frame {
  data: Uint8ClampedArray;
  /** How long this frame shows, in milliseconds (animations only). */
  delay: number;
}

export interface Raster {
  width: number;
  height: number;
  frames: Frame[];
}

export class ConvertError extends Error {}

/** Browsers' canvas limits vary; 50 MP stays inside all of them and inside WebAssembly memory. */
export const MAX_PIXELS = 50_000_000;
/** Total pixels across all frames of an animation (about 400 MB of RGBA). */
export const MAX_ANIMATION_PIXELS = 100_000_000;
export const MAX_FRAMES = 500;

export function checkSize(width: number, height: number, frames = 1) {
  if (!width || !height) throw new ConvertError("This image has no size.");
  if (width * height > MAX_PIXELS) {
    throw new ConvertError("This image is too large to convert in the browser (over 50 megapixels).");
  }
  if (frames > 1 && width * height * frames > MAX_ANIMATION_PIXELS) {
    throw new ConvertError("This animation is too large to convert in the browser. Try a shorter or smaller one.");
  }
}

/** Scales (w, h) down so the longer side is at most maxSide; never scales up. */
export function fitWithin(w: number, h: number, maxSide: number | null | undefined): { width: number; height: number } {
  if (!maxSide || (w <= maxSide && h <= maxSide)) return { width: w, height: h };
  const s = maxSide / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Puts transparent pixels on a white background (for JPG, BMP, EPS). */
export function flattenOnWhite(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a + 255 * (1 - a);
    out[i + 1] = data[i + 1] * a + 255 * (1 - a);
    out[i + 2] = data[i + 2] * a + 255 * (1 - a);
    out[i + 3] = 255;
  }
  return out;
}

// ---- Browser-only helpers (canvas) ----

export function newCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ConvertError("Your browser couldn't create a canvas.");
  return [canvas, ctx];
}

export function frameToCanvas(raster: Raster, index = 0): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(raster.width, raster.height);
  ctx.putImageData(new ImageData(raster.frames[index].data as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height), 0, 0);
  return canvas;
}

/** Draws any image source into RGBA pixels at the given size. */
export function sourceToPixels(src: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const [, ctx] = newCanvas(width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Resizes every frame so the longer side is at most maxSide. */
export function resizeRaster(raster: Raster, maxSide: number | null | undefined): Raster {
  const size = fitWithin(raster.width, raster.height, maxSide);
  if (size.width === raster.width && size.height === raster.height) return raster;
  return {
    ...size,
    frames: raster.frames.map((f, i) => ({ delay: f.delay, data: sourceToPixels(frameToCanvas(raster, i), size.width, size.height) })),
  };
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ConvertError("Your browser couldn't create this format."))), mime, quality),
  );
}
