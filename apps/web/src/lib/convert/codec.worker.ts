/// <reference lib="webworker" />
/**
 * Runs the heavy codecs off the main thread so the page stays responsive.
 * WebAssembly glue code builds functions at runtime, which the page's CSP
 * (rightly) forbids; this worker is served without that policy.
 *
 * Messages in:  { id, op: "decode", kind, bytes }  or  { id, op: "encode", format, raster, quality }
 * Messages out: { id, raster } / { id, bytes }  or  { id, error }
 */
import type { Frame, Raster } from "./raster";

const VENDOR = "/vendor/jsquash/";
const locateFile = (f: string) => VENDOR + f;

type Codec = { encode?: (...a: unknown[]) => Uint8Array | null; decode?: (...a: unknown[]) => ImageData | null };
const modules = new Map<string, Promise<Codec>>();

/** Loads one Emscripten codec once; the .wasm comes from /vendor/jsquash. */
function codec(key: string, load: () => Promise<{ default: (opts: object) => Promise<Codec> }>): Promise<Codec> {
  let m = modules.get(key);
  if (!m) {
    m = load().then((mod) => mod.default({ noInitialRun: true, locateFile }));
    modules.set(key, m);
  }
  return m;
}

async function simd(): Promise<boolean> {
  // Smallest module using a v128 instruction; validation fails without SIMD.
  return WebAssembly.validate(
    new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
  );
}

const still = (img: { width: number; height: number; data: Uint8ClampedArray }): Raster => ({
  width: img.width,
  height: img.height,
  frames: [{ data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), delay: 0 }],
});

async function decode(kind: string, bytes: Uint8Array): Promise<Raster> {
  switch (kind) {
    case "avif": {
      const m = await codec("avif-dec", () => import("@jsquash/avif/codec/dec/avif_dec.js") as never);
      const img = m.decode!(bytes, 8);
      if (!img) throw new Error("decode");
      return still(img);
    }
    case "jxl": {
      const m = await codec("jxl-dec", () => import("@jsquash/jxl/codec/dec/jxl_dec.js") as never);
      const img = m.decode!(bytes);
      if (!img) throw new Error("decode");
      return still(img);
    }
    case "webp": {
      const m = await codec("webp-dec", () => import("@jsquash/webp/codec/dec/webp_dec.js") as never);
      const img = m.decode!(bytes);
      if (!img) throw new Error("decode");
      return still(img);
    }
    case "heic": {
      const factory = (await import("libheif-js/libheif-wasm/libheif-bundle.mjs")).default;
      const libheif = await factory();
      const images = new libheif.HeifDecoder().decode(bytes);
      if (!images.length) throw new Error("decode");
      const image = images[0]; // the primary picture
      const width = image.get_width();
      const height = image.get_height();
      const data = new Uint8ClampedArray(width * height * 4);
      await new Promise<void>((resolve, reject) =>
        image.display({ data, width, height }, (out: unknown) => (out ? resolve() : reject(new Error("decode")))),
      );
      for (const im of images) im.free?.();
      return { width, height, frames: [{ data, delay: 0 }] };
    }
    case "tiff": {
      const UTIF = (await import("utif")).default;
      const buf = bytes.slice().buffer as ArrayBuffer;
      const ifds = UTIF.decode(buf);
      // Use the largest page (some TIFFs store a thumbnail first).
      const page = ifds.reduce((a, b) => ((b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a), ifds[0]);
      UTIF.decodeImage(buf, page, ifds);
      const rgba = UTIF.toRGBA8(page);
      return { width: page.width, height: page.height, frames: [{ data: new Uint8ClampedArray(rgba.buffer), delay: 0 }] };
    }
  }
  throw new Error(`unknown kind ${kind}`);
}

async function encode(format: string, raster: Raster, quality: number): Promise<Uint8Array> {
  const { width, height, frames } = raster;
  const first = frames[0].data;
  const q = Math.round(quality * 100);
  switch (format) {
    case "avif": {
      const m = await codec("avif-enc", () => import("@jsquash/avif/codec/enc/avif_enc.js") as never);
      const { defaultOptions } = await import("@jsquash/avif/meta.js");
      // jSquash maps quality 0-100; 100 is lossless.
      const out = m.encode!(new Uint8Array(first.buffer, first.byteOffset, first.byteLength), width, height, {
        ...defaultOptions,
        quality: q,
        ...(q >= 100 ? { lossless: true, qualityAlpha: -1, subsample: 3 } : {}),
      });
      if (!out) throw new Error("encode");
      return out;
    }
    case "jxl": {
      const m = await codec("jxl-enc", () => import("@jsquash/jxl/codec/enc/jxl_enc.js") as never);
      const { defaultOptions } = await import("@jsquash/jxl/meta.js");
      const out = m.encode!(first, width, height, { ...defaultOptions, quality: q, lossless: q >= 100 });
      if (!out) throw new Error("encode");
      return out;
    }
    case "webp": {
      const useSimd = await simd();
      const m = useSimd
        ? await codec("webp-enc-simd", () => import("@jsquash/webp/codec/enc/webp_enc_simd.js") as never)
        : await codec("webp-enc", () => import("@jsquash/webp/codec/enc/webp_enc.js") as never);
      const { defaultOptions } = await import("@jsquash/webp/meta.js");
      const out = m.encode!(first, width, height, { ...defaultOptions, quality: q, lossless: q >= 100 ? 1 : 0 });
      if (!out) throw new Error("encode");
      return out;
    }
    case "gif": {
      const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
      const gif = GIFEncoder();
      for (const f of frames) {
        const palette = quantize(f.data, 256, { format: "rgba4444", oneBitAlpha: true });
        const index = applyPalette(f.data, palette, "rgba4444");
        const transparentIndex = palette.findIndex((c) => c[3] === 0);
        gif.writeFrame(index, width, height, {
          palette,
          delay: frames.length > 1 ? Math.max(20, f.delay || 100) : 0,
          repeat: frames.length > 1 ? 0 : -1, // loop animations forever
          transparent: transparentIndex >= 0,
          transparentIndex: Math.max(0, transparentIndex),
        });
      }
      gif.finish();
      return gif.bytes();
    }
    case "apng": {
      const UPNG = (await import("upng-js")).default;
      const bufs = frames.map((f: Frame) => f.data.slice().buffer as ArrayBuffer);
      const delays = frames.map((f) => Math.max(20, f.delay || 100));
      return new Uint8Array(UPNG.encode(bufs, width, height, 0, frames.length > 1 ? delays : undefined));
    }
    case "tiff": {
      const UTIF = (await import("utif")).default;
      return new Uint8Array(UTIF.encodeImage(first, width, height));
    }
    case "svg": {
      const ImageTracer = (await import("imagetracerjs")).default;
      const svg: string = ImageTracer.imagedataToSVG(
        { width, height, data: first },
        { numberofcolors: 24, colorquantcycles: 3, pathomit: 4, roundcoords: 1, ltres: 0.5, qtres: 0.5, viewbox: true, strokewidth: 0, linefilter: true },
      );
      // Add a real size so design apps open it at the right dimensions.
      return new TextEncoder().encode(svg.replace("<svg ", `<svg width="${width}" height="${height}" `));
    }
  }
  throw new Error(`unknown format ${format}`);
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.op === "decode") {
      const raster = await decode(msg.kind, msg.bytes);
      self.postMessage({ id: msg.id, raster }, { transfer: raster.frames.map((f) => f.data.buffer as ArrayBuffer) });
    } else {
      const bytes = await encode(msg.format, msg.raster, msg.quality);
      self.postMessage({ id: msg.id, bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: String((err as Error)?.message ?? err) });
  }
};
