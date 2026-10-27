/**
 * In-browser image conversion. Files are decoded and re-encoded on the
 * visitor's device; nothing is uploaded.
 */
import { decodeFile } from "./decode";
import { OUTPUT_FORMATS, type ImageOutput, type OutputFormat } from "./formats";
import { ConvertError, canvasToBlob, flattenOnWhite, frameToCanvas, resizeRaster, type Raster } from "./raster";
import { encodeInWorker } from "./workers";
import { jpegToEps, pngToIco, rgbaToBmp } from "./writers";

export { ConvertError } from "./raster";
export { IMAGE_ACCEPT, OUTPUT_FORMATS, type ImageOutput } from "./formats";

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

let nativeWebp: boolean | undefined;
/** Chrome, Edge and Firefox save WebP from a canvas; Safari needs the WebAssembly encoder. */
function canvasSavesWebp(): boolean {
  if (nativeWebp === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    nativeWebp = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return nativeWebp;
}

const blobOf = (bytes: Uint8Array | string, mime: string) => new Blob([bytes as BlobPart], { type: mime });

/** Encodes a decoded picture into one output format. */
export async function encodeRaster(raster: Raster, format: OutputFormat, quality: number, title = "image"): Promise<Blob> {
  const one: Raster = format.animated ? raster : { ...raster, frames: [raster.frames[0]] };
  const flat = (): Raster => ({ ...one, frames: [{ delay: 0, data: flattenOnWhite(one.frames[0].data) }] });
  switch (format.id) {
    case "jpeg":
      return canvasToBlob(frameToCanvas(flat()), "image/jpeg", quality);
    case "png":
      return canvasToBlob(frameToCanvas(one), "image/png");
    case "webp":
      if (canvasSavesWebp()) return canvasToBlob(frameToCanvas(one), "image/webp", quality);
      return blobOf(await encodeInWorker("webp", one, quality), format.mime);
    case "bmp":
      return blobOf(rgbaToBmp(flat().frames[0].data, one.width, one.height), format.mime);
    case "ico": {
      const png = new Uint8Array(await (await canvasToBlob(frameToCanvas(one), "image/png")).arrayBuffer());
      return blobOf(pngToIco(png, one.width, one.height), format.mime);
    }
    case "eps": {
      const jpeg = await canvasToBlob(frameToCanvas(flat()), "image/jpeg", Math.max(quality, 0.9));
      return blobOf(jpegToEps(new Uint8Array(await jpeg.arrayBuffer()), one.width, one.height, title), format.mime);
    }
    default:
      // avif, jxl, gif, apng, tiff, svg
      return blobOf(await encodeInWorker(format.id, one, quality), format.id === "apng" ? "image/png" : format.mime);
  }
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
  frames: number;
}

export async function convertImage(file: File, opts: ConvertOptions): Promise<ConvertedImage> {
  const format = formatById(opts.format);
  const decoded = await decodeFile(file);
  const caps = [opts.maxSide, format.maxSide].filter((n): n is number => !!n);
  const raster = resizeRaster(decoded, caps.length ? Math.min(...caps) : null);
  let blob: Blob;
  try {
    blob = await encodeRaster(raster, format, opts.quality, file.name);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw new ConvertError(`This image couldn't be saved as ${format.label}. It may be too large; try a smaller size.`);
  }
  return {
    blob,
    name: outputName(file.name, format.ext),
    width: raster.width,
    height: raster.height,
    frames: format.animated ? raster.frames.length : 1,
  };
}
