import Link from "next/link";
import { Faq } from "@/components/home/Faq";
import { ProductIcon, ProductName, type ProductId } from "@/components/hub/products";
import { IconArrowRight, IconCheck, IconClock, IconLock, IconSparkle, IconZap } from "@/components/icons";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPage } from "@/components/seo/schema";
import { homeMetadata } from "@/lib/site";
import { pill } from "@/components/ui/styles";

export const metadata = homeMetadata;

interface ProductCardProps {
  id: ProductId;
  href: string;
  cta: string;
  title: string;
  points: string[];
  chips: string[];
  /** Secondary destinations shown as small links (above the card's main link). */
  links?: { href: string; label: string }[];
}

/**
 * A whole-card link: the product name is the real link, stretched over the
 * card with ::after, so there is one tab stop and no nested links. Extra
 * links sit above it (relative z-10).
 */
function ProductCard({ id, href, cta, title, points, chips, links }: ProductCardProps) {
  return (
    <article className="group relative flex overflow-hidden flex-col gap-5 rounded-xl border border-border bg-surface p-6 shadow-md transition-[transform,box-shadow,border-color] duration-200 ease-vn hover:-translate-y-1 hover:border-rose/40 hover:shadow-lg has-[a:focus-visible]:border-rose has-[a:focus-visible]:ring-4 has-[a:focus-visible]:ring-rose/25 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />
      <div className="flex items-center gap-4">
        <ProductIcon id={id} />
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl">
            <Link
              href={href}
              className="rounded-sm after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
            >
              <ProductName id={id} />
            </Link>
          </h2>
          <p className="font-bold text-muted">{title}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <IconCheck size={20} className="mt-0.5 shrink-0 text-success" />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap gap-1.5" aria-label="Formats">
        {chips.map((c) => (
          <li key={c} className={`${pill} bg-surface-2 px-2.5 py-0.5 text-xs text-text/80`}>
            {c}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex min-h-control items-center gap-2 rounded-md bg-brand-gradient px-5 text-lg font-bold text-white shadow-cta transition-transform duration-150 group-hover:-translate-y-px"
        >
          {cta}
          <IconArrowRight size={20} className="transition-transform duration-150 group-hover:translate-x-1" />
        </span>
        {links && (
          <p className="relative z-10 flex items-center gap-1 text-sm text-muted">
            or open
            {links.map((l, i) => (
              <span key={l.href} className="inline-flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">·</span>}
                <Link href={l.href} className="inline-flex min-h-tap items-center rounded-sm px-1 font-bold text-link underline-offset-4 hover:underline">
                  {l.label}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}

/** Shortcuts straight into a tool, with the right options already picked. */
const TASKS: { label: string; href: string; product: ProductId }[] = [
  { label: "HEIC to JPG", href: "/convert/images?to=jpeg", product: "convabbit" },
  { label: "Word to PDF", href: "/convert/documents?tool=word-to-pdf", product: "convabbit" },
  { label: "PDF to Word", href: "/convert/documents?tool=pdf-to-word", product: "convabbit" },
  { label: "PNG to JPG", href: "/convert/images?to=jpeg", product: "convabbit" },
  { label: "JPG to PNG", href: "/convert/images?to=png", product: "convabbit" },
  { label: "Image to WebP", href: "/convert/images?to=webp", product: "convabbit" },
  { label: "PNG to SVG", href: "/convert/images?to=svg", product: "convabbit" },
  { label: "Make a favicon", href: "/convert/images?to=ico", product: "convabbit" },
  { label: "Merge PDFs", href: "/convert/documents?tool=merge-pdf", product: "convabbit" },
  { label: "PDF to JPG", href: "/convert/documents?tool=pdf-to-images", product: "convabbit" },
  { label: "Images to PDF", href: "/convert/documents?tool=images-to-pdf", product: "convabbit" },
  { label: "Video to MP4", href: "/download#nab", product: "vidnabbit" },
  { label: "Audio to MP3", href: "/download#nab", product: "vidnabbit" },
];

const PROMISES = [
  { Icon: IconSparkle, title: "Free, really", body: "No sign-up, no watermark, no limits on how often you use it." },
  { Icon: IconLock, title: "Private", body: "Conversions happen on your device. Downloads are deleted from our servers after 1 hour." },
  { Icon: IconZap, title: "Fast on any device", body: "Works in Chrome, Safari, Edge and Firefox, on phones and computers." },
];

const HUB_FAQ = [
  {
    q: "What's the difference between VidNabbit and Convabbit?",
    a: "VidNabbit saves videos, music and images from a public link, such as your own uploads or Creative Commons media. Convabbit converts files you already have: images between formats, Word to PDF, PDF to Word, and more.",
  },
  {
    q: "Is it free?",
    a: "Yes. Both are free to use with no account and no watermark.",
  },
  {
    q: "Are my files uploaded?",
    a: "Convabbit never uploads your files: everything is converted in your browser. VidNabbit fetches media from the link you paste and deletes it from our servers after 1 hour.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes. Both work in any modern mobile browser. Saved files go to your phone's Downloads or Files app.",
  },
];

export default function Hub() {
  return (
    <>
      <JsonLd data={faqPage(HUB_FAQ)} />
      <div className="vn-hero-glow">
        <div className="mx-auto flex w-full max-w-page flex-col gap-10 px-4 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-20">
          <div className="flex flex-col items-center gap-5 text-center">
            <p className={`${pill} bg-sun text-ink`}>Free · No sign-up · Private</p>
            <h1 className="text-balance text-3xl sm:text-5xl">
              Nab it or convert it. <span className="text-brand-gradient sm:block">Your free media toolbox.</span>
            </h1>
            <p className="max-w-2xl text-pretty text-lg text-muted">
              Save videos, music and images from links with VidNabbit. Convert images and documents with Convabbit. Pick a
              tool to start.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            <ProductCard
              id="vidnabbit"
              href="/download"
              cta="Download media"
              title="Video, music and image downloader"
              points={[
                "Paste a public link, then pick the format",
                "MP4 up to 4K, MP3 and M4A audio, original images",
                "Files are deleted after 1 hour",
              ]}
              chips={["MP4", "MP3", "M4A", "JPG", "PNG", "4K"]}
            />
            <ProductCard
              id="convabbit"
              href="/convert/images"
              cta="Convert files"
              title="Image and document converter"
              points={[
                "Every common image format, including HEIC, RAW and SVG",
                "Word to PDF, PDF to Word, merge PDFs",
                "Runs in your browser: files never leave your device",
              ]}
              chips={["JPG", "PNG", "WebP", "HEIC", "AVIF", "SVG", "PDF", "DOCX"]}
              links={[
                { href: "/convert/images", label: "Images" },
                { href: "/convert/documents", label: "Documents" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-page flex-col gap-16 px-4 pb-14 pt-8 sm:gap-20 sm:px-6 sm:pb-16 sm:pt-10">
        <section aria-labelledby="tasks-heading" className="flex flex-col items-center gap-5">
          <h2 id="tasks-heading" className="text-center text-2xl sm:text-3xl">
            Popular tasks
          </h2>
          <ul className="flex max-w-3xl flex-wrap justify-center gap-2.5">
            {TASKS.map((t) => (
              <li key={t.label}>
                <Link
                  href={t.href}
                  className="group inline-flex min-h-tap items-center gap-2 rounded-full border border-border bg-surface px-4 font-bold shadow-sm transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:border-rose/50 hover:shadow-md"
                >
                  <ProductIcon id={t.product} size="sm" />
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Why people use it" className="grid gap-4 sm:grid-cols-3">
          {PROMISES.map(({ Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 shadow-sm">
              <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-md bg-accent-subtle text-accent-strong">
                <Icon size={22} />
              </span>
              <h3 className="text-lg">{title}</h3>
              <p className="text-muted">{body}</p>
            </div>
          ))}
        </section>

        <Faq items={HUB_FAQ} headingId="hub-faq-heading" />
        <p className="-mt-8 flex items-center justify-center gap-1.5 text-center text-sm text-muted">
          <IconClock size={16} /> Downloads are deleted after 1 hour. Conversions never leave your device.
        </p>
      </div>
    </>
  );
}
