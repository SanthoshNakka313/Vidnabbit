import { Downloader } from "@/components/downloader/Downloader";
import { Faq } from "@/components/home/Faq";
import { Features, FinalCta, FormatsShowcase, TrustRow } from "@/components/home/HomeSections";
import { HowItWorksSteps } from "@/components/HowItWorksSteps";
import { HomeJsonLd } from "@/components/seo/HomeJsonLd";
import { homeFaq } from "@/lib/faq";
import { pageMetadata } from "@/lib/site";
import Link from "next/link";
import { ProductEyebrow, ProductSwitch } from "@/components/hub/products";
import { linkInline, pill } from "@/components/ui/styles";

export const metadata = pageMetadata({
  title: "Free video, music and image downloader: MP4, MP3, JPG",
  description:
    "VidNabbit saves videos, music and images from public links as MP4, MP3, M4A or the original file. Free, no sign-up, up to 4K, files deleted after 1 hour.",
  path: "/download",
});

export default function DownloadPage() {
  return (
    <>
      <HomeJsonLd />
      <div className="vn-hero-glow">
        <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 pb-14 pt-12 text-center sm:px-6 sm:pb-20 sm:pt-20">
          <div className="flex flex-col items-center gap-5">
            <ProductEyebrow product="vidnabbit" />
            <p className={`${pill} bg-sun text-ink`}>Free · No sign-up · Up to 4K</p>
            <h1 className="text-balance text-3xl sm:text-4xl">
              Paste a link.{" "}
              <span className="text-brand-gradient sm:block">Nab the video, audio or image.</span>
            </h1>
            <p className="max-w-xl text-pretty text-lg text-muted">
              Download video, audio and images you own or have the right to save, as MP4, MP3, M4A or
              the original file. Free, no sign-up, deleted after 1 hour.
            </p>
          </div>
          <div id="nab" className="scroll-mt-24">
            <Downloader />
          </div>
          <TrustRow />
          <ProductSwitch to="convabbit" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-page flex-col gap-20 px-4 py-16 sm:gap-24 sm:px-6 sm:py-20">
        <HowItWorksSteps />
        <Features />
        <FormatsShowcase />
        <div className="flex flex-col gap-6">
          <Faq items={homeFaq} />
          <p className="text-center text-muted">
            More questions?{" "}
            <Link href="/faq" className={linkInline}>
              Read the full FAQ
            </Link>{" "}
            or our guide on{" "}
            <Link href="/guides/is-it-legal-to-download-videos" className={linkInline}>
              whether downloading is legal
            </Link>
            .
          </p>
        </div>
        <FinalCta />
      </div>
    </>
  );
}
