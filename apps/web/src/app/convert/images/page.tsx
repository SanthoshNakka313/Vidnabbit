import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { ImageConverter } from "@/components/convert/ImageConverter";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free image converter: PNG, JPG, WebP, AVIF and ICO",
  description:
    "Convert images between PNG, JPG, WebP, AVIF and ICO for free, right in your browser. Batch convert, resize and download as a ZIP. Your files never leave your device.",
  path: "/convert/images",
});

const FAQ = [
  {
    q: "Are my images uploaded anywhere?",
    a: "No. The conversion runs in your web browser on your own device. Your images are never sent to VidNabbit or anyone else, so it also works for private photos.",
  },
  {
    q: "Which formats can I convert?",
    a: "You can open PNG, JPG, WebP, AVIF, GIF, BMP, SVG and ICO files (and HEIC photos in Safari), and save them as PNG, JPG, WebP, AVIF or ICO. AVIF saving needs a recent Chrome, Edge or Firefox.",
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
];

export default function ImageConverterPage() {
  return (
    <ConvertPage
      tab="/convert/images"
      crumb="Image converter"
      title={
        <>
          Free image converter. <span className="text-brand-gradient sm:block">PNG, JPG, WebP and more.</span>
        </>
      }
      intro="Convert, resize and batch-save images right in your browser. Nothing is uploaded, and it's free."
      faq={FAQ}
    >
      <ImageConverter />
    </ConvertPage>
  );
}
