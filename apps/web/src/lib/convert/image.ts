/**
 * In-browser image conversion. Files are decoded and re-encoded with the
 * browser's own codecs on a canvas; nothing is uploaded.
 */

export type ImageOutput = "png" | "jpeg" | "webp" | "avif" | "ico";

export interface OutputFormat {
  id: ImageOutput;
  label: string;
  ext: string;
  mime: string;
  /** Lossy formats take a quality setting. */
  lossy: boolean;
  /** JPEG has no transparency, so transparent pixels get a white background. */
  opaque: boolean;
}

export const OUTPUT_FORMATS: OutputFormat[] = [
  { id: "png", label: "PNG", ext: "png", mime: "image/png", lossy: false, opaque: false },
  { id: "jpeg", label: "JPG", ext: "jpg", mime: "image/jpeg", lossy: true, opaque: true },
  { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", lossy: true, opaque: false },
  { id: "avif", label: "AVIF", ext: "avif", mime: "image/avif", lossy: true, opaque: false },
  { id: "ico", label: "ICO (favicon)", ext: "ico", mime: "image/x-icon", lossy: false, opaque: false },
];

/** What the file picker accepts. HEIC only decodes where the browser supports it (Safari). */
export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/heic,image/heif,.heic,.heif,.ico";

export const MAX_IMAGE_BYTES = 50 * 1000 * 1000;
/** Canvas limits vary by browser; 100 MP stays inside all of them. */
export const MAX_PIXELS = 100_000_000;
const ICO_MAX_SIDE = 256;

export function formatById(id: ImageOutput): OutputFormat {
  const f = OUTPUT_FORMATS.find((o) => o.id === id);
  if (!f) throw new Error(`Unknown format ${id}`);
  return f;
}

/** "holiday.photo.HEIC" + "jpg" -> "holiday.photo.jpg" */
export function outputName(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).trim() || "image";
  return `${base}.${ext}`;
}

/** Scales (w, h) down so the longer side is at most maxSide; never scales up. */
export function fitWithin(w: number, h: number, maxSide: number | null): { width: number; height: number } {
  if (!maxSide || (w <= maxSide && h <= maxSide)) return { width: w, height: h };
  const s = maxSide / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export class ConvertError extends Error {}

/** Decodes any image the browser can show. Uses <img> so SVG and ICO work too. */
export async function decodeImage(file: Blob): Promise<HTMLImageElement> {
  if (file.size > MAX_IMAGE_BYTES) throw new ConvertError("This file is over 50 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new ConvertError("This image has no size.");
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
      throw new ConvertError("This image is too large to convert in the browser (over 100 megapixels).");
    }
    return img;
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError(
      "Your browser can't open this image. HEIC photos only open in Safari; try converting them on an iPhone or Mac.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ConvertError("Your browser couldn't create this format."))), mime, quality),
  );
}

export function drawToCanvas(
  img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number },
  size: { width: number; height: number },
  background?: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ConvertError("Your browser couldn't create a canvas.");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return canvas;
}

/** Whether this browser can encode the format (AVIF encoding is not universal). */
export function canEncode(format: OutputFormat): boolean {
  if (format.id === "ico" || format.id === "png") return true;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.toDataURL(format.mime).startsWith(`data:${format.mime}`);
}

/**
 * Wraps one PNG in an ICO container (supported by every current browser and
 * Windows Vista+). Header, one directory entry, then the PNG bytes.
 */
export function pngToIco(png: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(6 + 16 + png.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, 1, true); // one image
  v.setUint8(6, width >= 256 ? 0 : width); // 0 means 256
  v.setUint8(7, height >= 256 ? 0 : height);
  v.setUint8(8, 0); // no palette
  v.setUint8(9, 0); // reserved
  v.setUint16(10, 1, true); // colour planes
  v.setUint16(12, 32, true); // bits per pixel
  v.setUint32(14, png.length, true);
  v.setUint32(18, 22, true); // offset of the PNG data
  out.set(png, 22);
  return out;
}

export interface ConvertOptions {
  format: ImageOutput;
  /** 0-1, for lossy formats. */
  quality: number;
  /** Longest side in pixels, or null for the original size. */
  maxSide: number | null;
}

export interface ConvertedImage {
  blob: Blob;
  name: string;
  width: number;
  height: number;
}

export async function convertImage(file: File, opts: ConvertOptions): Promise<ConvertedImage> {
  const format = formatById(opts.format);
  const img = await decodeImage(file);
  const maxSide = format.id === "ico" ? Math.min(opts.maxSide ?? ICO_MAX_SIDE, ICO_MAX_SIDE) : opts.maxSide;
  const size = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
  const canvas = drawToCanvas(img, size, format.opaque ? "#ffffff" : undefined);
  let blob: Blob;
  if (format.id === "ico") {
    const png = new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());
    blob = new Blob([pngToIco(png, size.width, size.height) as BlobPart], { type: format.mime });
  } else {
    blob = await canvasToBlob(canvas, format.mime, format.lossy ? opts.quality : undefined);
    if (blob.type !== format.mime) throw new ConvertError(`Your browser can't save ${format.label} files.`);
  }
  return { blob, name: outputName(file.name, format.ext), ...size };
}
