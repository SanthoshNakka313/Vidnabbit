/**
 * Every image format the converter knows about: what it can open, what it
 * can save, and how. Formats that only open (HEIC, RAW, AI) are listed in
 * INPUT_ONLY so the page can say so plainly.
 */

export type ImageOutput =
  | "jpeg"
  | "png"
  | "apng"
  | "gif"
  | "webp"
  | "avif"
  | "jxl"
  | "tiff"
  | "bmp"
  | "ico"
  | "svg"
  | "eps";

export interface OutputFormat {
  id: ImageOutput;
  label: string;
  ext: string;
  mime: string;
  /** Lossy formats take a quality setting. */
  lossy: boolean;
  /** No transparency: transparent pixels get a white background. */
  opaque: boolean;
  /** Keeps every frame of an animated GIF, APNG or WebP. */
  animated: boolean;
  /** Longest side this format allows (ICO), or a sensible cap (SVG tracing). */
  maxSide?: number;
  /** One line shown under the format picker. */
  note?: string;
}

export const OUTPUT_FORMATS: OutputFormat[] = [
  { id: "jpeg", label: "JPG", ext: "jpg", mime: "image/jpeg", lossy: true, opaque: true, animated: false, note: "JPG has no transparency, so transparent areas become white." },
  { id: "png", label: "PNG", ext: "png", mime: "image/png", lossy: false, opaque: false, animated: false },
  { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", lossy: true, opaque: false, animated: false, note: "Animated images are saved as their first frame. Use GIF or APNG to keep the animation." },
  { id: "avif", label: "AVIF", ext: "avif", mime: "image/avif", lossy: true, opaque: false, animated: false, note: "AVIF gives the smallest files but takes a few seconds per photo." },
  { id: "jxl", label: "JPEG XL", ext: "jxl", mime: "image/jxl", lossy: true, opaque: false, animated: false, note: "JPEG XL opens in Safari, Photoshop and most photo apps; Chrome needs a plug-in." },
  { id: "gif", label: "GIF", ext: "gif", mime: "image/gif", lossy: false, opaque: false, animated: true, note: "GIF is limited to 256 colours. Animations are kept." },
  { id: "apng", label: "APNG (animated PNG)", ext: "png", mime: "image/apng", lossy: false, opaque: false, animated: true, note: "Animations are kept, in full colour." },
  { id: "tiff", label: "TIFF", ext: "tif", mime: "image/tiff", lossy: false, opaque: false, animated: false, note: "Uncompressed TIFF, for print and publishing. Files are large." },
  { id: "bmp", label: "BMP", ext: "bmp", mime: "image/bmp", lossy: false, opaque: true, animated: false, note: "BMP has no transparency, so transparent areas become white." },
  { id: "ico", label: "ICO (favicon)", ext: "ico", mime: "image/x-icon", lossy: false, opaque: false, animated: false, maxSide: 256, note: "Favicons are at most 256×256 px." },
  { id: "svg", label: "SVG (traced vector)", ext: "svg", mime: "image/svg+xml", lossy: false, opaque: false, animated: false, maxSide: 1200, note: "Traces the picture into vector shapes. Best for logos, icons and flat artwork, not photos." },
  { id: "eps", label: "EPS", ext: "eps", mime: "application/postscript", lossy: true, opaque: true, animated: false, note: "EPS for print. The picture is embedded as a high-quality image." },
];

/** Formats people ask for that can be opened but not created in a browser. */
export const INPUT_ONLY = [
  { label: "HEIC / HEIF", why: "Saving HEIC needs a patented encoder that isn't free to use." },
  { label: "RAW / DNG", why: "RAW is a camera's sensor data, so it can't be made from a picture." },
  { label: "AI", why: "Illustrator's format is proprietary. Save as SVG or EPS instead." },
] as const;

export type InputKind = "native" | "avif" | "jxl" | "heic" | "tiff" | "raw" | "pdf" | "eps";

const RAW_EXTS = ["dng", "raw", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "rwl", "pef", "srw", "x3f", "3fr", "iiq", "mrw", "erf", "kdc", "dcr"];

/** What the file picker accepts. */
export const IMAGE_ACCEPT = [
  "image/*",
  ".jpg", ".jpeg", ".jfif", ".png", ".apng", ".gif", ".webp", ".avif", ".jxl", ".tif", ".tiff",
  ".bmp", ".heic", ".heif", ".svg", ".ico", ".ai",
  ...RAW_EXTS.map((e) => `.${e}`),
  ".eps",
].join(",");

export const INPUT_LABEL =
  "JPG, PNG, APNG, GIF, WebP, AVIF, JPEG XL, TIFF, BMP, HEIC, RAW/DNG, SVG, ICO and AI";

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/**
 * Picks a decoder from the file's first bytes, falling back to its extension.
 * Bytes win because files are often misnamed (a ".jpg" that is really HEIC).
 */
export function detectInput(head: Uint8Array, name: string): InputKind {
  const ext = extOf(name);
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
    if (brand === "crx ") return "raw"; // Canon CR3
  }
  if (head[0] === 0xff && head[1] === 0x0a) return "jxl"; // bare JPEG XL codestream
  if (head.length >= 12 && ascii(head, 4, 8) === "JXL ") return "jxl"; // JPEG XL container
  if (ascii(head, 0, 5) === "%PDF-") return "pdf"; // also modern .ai files
  if (ascii(head, 0, 4) === "%!PS" || (head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6)) return "eps";
  if (RAW_EXTS.includes(ext)) return "raw"; // most RAW formats are TIFF inside, so check before TIFF
  if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a)) return "tiff";
  if (ext === "ai") return "pdf";
  return "native";
}
