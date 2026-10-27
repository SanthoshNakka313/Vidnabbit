import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { ImageConverter } from "@/components/convert/ImageConverter";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free image converter: JPG, PNG, WebP, HEIC, AVIF, TIFF, SVG and more",
  description:
    "Convert JPG, PNG, WebP, GIF, AVIF, JPEG XL, TIFF, BMP, HEIC, RAW/DNG, SVG, ICO, EPS and AI files for free, right in your browser. Batch convert, resize and keep animations. Nothing is uploaded.",
  path: "/convert/images",
});

const FAQ = [
  {
    q: "Are my images uploaded anywhere?",
    a: "No. The conversion runs in your web browser on your own device. Your images are never sent to VidNabbit or anyone else, so it also works for private photos.",
  },
  {
    q: "Which formats can I convert?",
    a: "You can open JPG, PNG, APNG, GIF, WebP, AVIF, JPEG XL, TIFF, BMP, HEIC/HEIF, camera RAW and DNG, SVG, ICO and Illustrator (.ai) files. You can save as JPG, PNG, APNG, GIF, WebP, AVIF, JPEG XL, TIFF, BMP, ICO, SVG and EPS. It works the same in Chrome, Edge, Firefox and Safari.",
  },
  {
    q: "Why can't I save as HEIC, RAW or AI?",
    a: "HEIC needs a patented encoder that isn't free to use. RAW is the data straight from a camera's sensor, so it can't be made from a finished picture. Illustrator's AI format is proprietary, so save as SVG or EPS instead. EPS files can be saved but not opened here.",
  },
  {
    q: "Are animated GIFs kept?",
    a: "Yes. Converting between GIF and APNG (animated PNG) keeps every frame and its timing. Other formats save the first frame.",
  },
  {
    q: "How does PNG to SVG work?",
    a: "The picture is traced into vector shapes, which suits logos, icons and flat artwork. Photos trace into many small shapes and are better kept as JPG or WebP.",
  },
  {
    q: "Is it really free?",
    a: "Yes. There's no sign-up, no watermark and no limit on how many times you use it. You can convert up to 50 images at a time.",
  },
  {
    q: "Why did my transparent PNG get a white background?",
    a: "JPG doesn't support transparency, so transparent areas become white. Choose PNG, WebP or AVIF to keep transparency.",
  },
  {
    q: "How do I make a favicon?",
    a: "Choose ICO (favicon), add a square PNG or SVG, and download the .ico file. Favicons are saved at up to 256×256 pixels.",
  },
  {
    q: "What software does the converter use?",
    a: "Free, open-source libraries that run in your browser: jSquash (AVIF, JPEG XL, WebP; Apache-2.0), libheif (HEIC; LGPL-3.0), LibRaw (RAW; LGPL-2.1/CDDL), UTIF and UPNG (TIFF, APNG; MIT), gifenc (GIF; MIT), ImageTracer (SVG; public domain) and PDF.js (AI; Apache-2.0). They are loaded as separate, unmodified files only when needed.",
  },
];

export default function ImageConverterPage() {
  return (
    <ConvertPage
      tab="/convert/images"
      crumb="Image converter"
      title={
        <>
          Free image converter. <span className="text-brand-gradient sm:block">Every common format.</span>
        </>
      }
      intro="JPG, PNG, WebP, HEIC, AVIF, TIFF, RAW, SVG and more. Convert, resize and batch-save right in your browser. Nothing is uploaded, and it's free."
      faq={FAQ}
    >
      <ImageConverter />
    </ConvertPage>
  );
}
