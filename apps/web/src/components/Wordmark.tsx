import Link from "next/link";

/**
 * The brand logo, from brand/svg (copied to public/brand). BRAND.md: always use
 * the files, never redraw; light-background logo by default, dark one in dark mode.
 * Height 36px renders it 125px wide, above the 120px minimum for the horizontal logo.
 */
export function Wordmark({ className = "h-9" }: { className?: string }) {
  return (
    <Link href="/" className="inline-flex min-h-tap shrink-0 items-center rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image adds nothing here */}
      <img
        src="/brand/vidnabbit-logo-horizontal.svg"
        alt="VidNabbit home"
        width={417}
        height={120}
        className={`vn-logo-light w-auto ${className}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src="/brand/vidnabbit-logo-horizontal-dark.svg"
        alt="VidNabbit home"
        width={417}
        height={120}
        className={`vn-logo-dark w-auto ${className}`}
      />
    </Link>
  );
}

/** Small brand mark for loaders and empty states (decorative). */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG mark
    <img src="/brand/vidnabbit-mark.svg" alt="" aria-hidden="true" width={120} height={120} className={className} />
  );
}
