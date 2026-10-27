// Minimal types for the untyped image libraries used by the converter.

declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    [tag: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): IFD[];
    decodeImage(buf: ArrayBuffer, ifd: IFD, ifds?: IFD[]): void;
    toRGBA8(ifd: IFD): Uint8Array;
    encodeImage(rgba: ArrayLike<number>, w: number, h: number, metadata?: object): ArrayBuffer;
  };
  export default UTIF;
}

declare module "upng-js" {
  interface Decoded {
    width: number;
    height: number;
    frames: { delay: number }[];
  }
  const UPNG: {
    decode(buf: ArrayBuffer): Decoded;
    toRGBA8(img: Decoded): ArrayBuffer[];
    encode(frames: ArrayBuffer[], w: number, h: number, cnum: number, delays?: number[]): ArrayBuffer;
  };
  export default UPNG;
}

declare module "imagetracerjs" {
  const ImageTracer: {
    imagedataToSVG(img: { width: number; height: number; data: ArrayLike<number> }, options?: object): string;
  };
  export default ImageTracer;
}

declare module "gifenc" {
  type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(
    rgba: ArrayLike<number>,
    maxColors: number,
    opts?: { format?: string; oneBitAlpha?: boolean | number },
  ): Palette;
  export function applyPalette(rgba: ArrayLike<number>, palette: Palette, format?: string): Uint8Array;
}

declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (out: unknown) => void): void;
    free?(): void;
  }
  const factory: (opts?: object) => Promise<{ HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } }>;
  export default factory;
}

declare module "@jsquash/avif/codec/dec/avif_dec.js";
declare module "@jsquash/avif/codec/enc/avif_enc.js";
declare module "@jsquash/jxl/codec/dec/jxl_dec.js";
declare module "@jsquash/jxl/codec/enc/jxl_enc.js";
declare module "@jsquash/webp/codec/dec/webp_dec.js";
declare module "@jsquash/webp/codec/enc/webp_enc.js";
declare module "@jsquash/webp/codec/enc/webp_enc_simd.js";
