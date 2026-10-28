import Link from "next/link";
import { IconArrowRight, IconConvert, IconResume } from "../icons";

/**
 * The site's products. VidNabbit downloads media from links; Convabbit converts
 * files and ResuNabbit checks and polishes resumes, both on the visitor's device.
 * Names are split like the logo wordmark: ink first half, rose second half.
 */
export type ProductId = "vidnabbit" | "convabbit" | "resunabbit";

export const PRODUCTS = {
  vidnabbit: { name: ["Vid", "Nabbit"], href: "/download", label: "Downloader" },
  convabbit: { name: ["Conv", "abbit"], href: "/convert/images", label: "Converter" },
  resunabbit: { name: ["Resu", "Nabbit"], href: "/resume/ats-checker", label: "Resume tools" },
} as const;

export function ProductName({ id, className = "" }: { id: ProductId; className?: string }) {
  const [a, b] = PRODUCTS[id].name;
  return (
    <span className={`font-black tracking-tight ${className}`}>
      <span className="text-text">{a}</span>
      <span className="text-rose">{b}</span>
    </span>
  );
}

/**
 * Product icon. VidNabbit uses the official app icon (BRAND.md: never redraw it).
 * Convabbit and ResuNabbit have no logos yet, so each gets a plain glyph on the brand gradient.
 */
const ICON_SIZES = { sm: ["size-7", 16], lg: ["size-14 sm:size-16", 32] } as const;

export function ProductIcon({ id, size = "lg" }: { id: ProductId; size?: keyof typeof ICON_SIZES }) {
  const [cls, glyph] = ICON_SIZES[size];
  if (id === "vidnabbit") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static brand SVG
      <img src="/brand/vidnabbit-icon.svg" alt="" aria-hidden="true" width={64} height={64} className={`${cls} shrink-0 rounded-[22%]`} />
    );
  }
  const Glyph = id === "convabbit" ? IconConvert : IconResume;
  return (
    <span aria-hidden="true" className={`${cls} inline-flex shrink-0 items-center justify-center rounded-[22%] bg-brand-gradient text-white`}>
      <Glyph size={glyph} strokeWidth={2.2} />
    </span>
  );
}

/** Small label above a product page's heading: icon + name + what it is. */
export function ProductEyebrow({ product }: { product: ProductId }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3.5 shadow-sm">
      <ProductIcon id={product} size="sm" />
      <ProductName id={product} className="text-base" />
      <span className="text-sm font-bold text-muted">· {PRODUCTS[product].label}</span>
    </p>
  );
}

/** One-line hop to the other product, under a page's main tool. */
export function ProductSwitch({ to }: { to: ProductId }) {
  const text = {
    convabbit: "Need to convert a file instead?",
    vidnabbit: "Need to save a video, song or image from a link?",
    resunabbit: "Applying for jobs? Check your resume's ATS score.",
  }[to];
  return (
    <p className="text-center text-sm text-muted">
      {text}{" "}
      <Link href={PRODUCTS[to].href} className="group inline-flex items-center gap-1 font-bold text-link hover:text-text">
        Try <ProductName id={to} />
        <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </p>
  );
}
