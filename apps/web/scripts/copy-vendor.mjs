// Copies third-party runtime files next to the site so they are served from
// our own origin (CSP 'self') and always match the installed packages:
// - PDF.js worker plus its character maps, fonts, image decoders and colour profiles
// - WebAssembly image codecs (jSquash AVIF / JPEG XL / WebP), single-threaded builds
// - LibRaw's worker and WebAssembly (camera RAW files)
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const pdfjs = pkgDir("pdfjs-dist");
const pdfOut = "public/vendor/pdfjs";
mkdirSync(pdfOut, { recursive: true });
cpSync(join(pdfjs, "build", "pdf.worker.min.mjs"), join(pdfOut, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(pdfjs, dir), join(pdfOut, dir), { recursive: true });
}

const jsquashOut = "public/vendor/jsquash";
mkdirSync(jsquashOut, { recursive: true });
for (const codec of ["avif", "jxl", "webp"]) {
  for (const part of ["enc", "dec"]) {
    const dir = join(pkgDir(`@jsquash/${codec}`), "codec", part);
    for (const f of readdirSync(dir)) {
      // Multi-threaded builds need cross-origin isolation, which the site doesn't use.
      if (f.endsWith(".wasm") && !f.includes("_mt")) cpSync(join(dir, f), join(jsquashOut, f));
    }
  }
}

const librawOut = "public/vendor/libraw";
mkdirSync(librawOut, { recursive: true });
// libraw.js is what its worker threads load.
for (const f of ["worker.js", "libraw.js", "libraw.wasm"]) cpSync(join(pkgDir("libraw-wasm"), "dist", f), join(librawOut, f));
