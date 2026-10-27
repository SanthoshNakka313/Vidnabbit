/** Small file-format writers that need no library: BMP, ICO and EPS. */

/** 24-bit BMP (opens everywhere). Expects RGBA already flattened onto white. */
export function rgbaToBmp(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4; // rows are padded to 4 bytes
  const dataSize = rowSize * height;
  const out = new Uint8Array(54 + dataSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true); // pixel data offset
  v.setUint32(14, 40, true); // BITMAPINFOHEADER
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // positive: rows stored bottom-up
  v.setUint16(26, 1, true); // colour planes
  v.setUint16(28, 24, true); // bits per pixel
  v.setUint32(34, dataSize, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++, dst += 3) {
      const i = src + x * 4;
      out[dst] = rgba[i + 2]; // BMP is BGR
      out[dst + 1] = rgba[i + 1];
      out[dst + 2] = rgba[i];
    }
  }
  return out;
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

/** ASCII85 (Adobe flavour, with "~>" terminator), wrapped at 72 columns. */
export function ascii85(bytes: Uint8Array): string {
  const parts: string[] = [];
  let line = "";
  const push = (s: string) => {
    for (const ch of s) {
      line += ch;
      if (line.length === 72) {
        parts.push(line);
        line = "";
      }
    }
  };
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i);
    let value = 0;
    for (let j = 0; j < 4; j++) value = value * 256 + (j < n ? bytes[i + j] : 0);
    if (value === 0 && n === 4) {
      push("z");
      continue;
    }
    const chars = new Array<string>(5);
    for (let j = 4; j >= 0; j--) {
      chars[j] = String.fromCharCode(33 + (value % 85));
      value = Math.floor(value / 85);
    }
    push(chars.slice(0, n + 1).join(""));
  }
  if (line) parts.push(line);
  return `${parts.join("\n")}~>`;
}

/**
 * EPS (PostScript level 2) with the picture embedded as a JPEG
 * (DCTDecode inside ASCII85), sized at 72 dpi. Opens in Illustrator,
 * InDesign, CorelDRAW, Affinity, Inkscape and Ghostscript.
 */
export function jpegToEps(jpeg: Uint8Array, width: number, height: number, title: string): string {
  const safeTitle = title.replace(/[()\\\r\n]/g, "_");
  return [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${width} ${height}`,
    `%%HiResBoundingBox: 0 0 ${width} ${height}`,
    `%%Title: (${safeTitle})`,
    "%%Creator: VidNabbit",
    "%%LanguageLevel: 2",
    "%%Pages: 1",
    "%%EndComments",
    "%%Page: 1 1",
    "gsave",
    `${width} ${height} scale`,
    "/DeviceRGB setcolorspace",
    "<<",
    "  /ImageType 1",
    `  /Width ${width}`,
    `  /Height ${height}`,
    "  /BitsPerComponent 8",
    "  /Decode [0 1 0 1 0 1]",
    `  /ImageMatrix [${width} 0 0 -${height} 0 ${height}]`,
    "  /DataSource currentfile /ASCII85Decode filter /DCTDecode filter",
    ">> image",
    ascii85(jpeg),
    "grestore",
    "showpage",
    "%%EOF",
    "",
  ].join("\n");
}
