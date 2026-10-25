/**
 * Shared class strings for buttons, links, inputs and cards (BRAND.md "UI style").
 * Kept as strings (not a component) so they work on <button>, <a> and <Link>.
 */
const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 font-bold text-base min-h-control min-w-tap " +
  "transition-[background-color,box-shadow,transform,color] duration-150 ease-vn select-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed";

/**
 * Main CTA: brand gradient. Labels are 18px bold (WCAG large text) because the
 * coral end of the gradient is 3.4:1 with white.
 */
export const buttonPrimary =
  `${base} bg-brand-gradient text-white text-lg shadow-cta hover:brightness-105 ` +
  "enabled:hover:-translate-y-px enabled:active:translate-y-0 aria-disabled:shadow-none disabled:shadow-none";

/** Secondary: violet outline (BRAND.md: violet for secondary buttons). */
export const buttonSecondary =
  `${base} bg-surface text-accent-strong border-2 border-accent-strong/30 hover:border-accent-strong hover:bg-accent-subtle`;

export const buttonGhost = `${base} text-link hover:bg-surface-2 underline-offset-4 hover:underline`;

export const linkInline =
  "text-link font-bold underline decoration-accent decoration-2 underline-offset-[3px] hover:text-text rounded-sm";

export const inputBase =
  "w-full rounded-md border-2 border-strong/60 bg-surface text-text text-base px-4 placeholder:text-muted " +
  "transition-colors duration-150 hover:border-strong focus:border-accent-strong focus:outline-none " +
  "focus-visible:ring-4 focus-visible:ring-accent-strong/20 aria-invalid:border-danger";

export const card = "rounded-lg border border-border bg-surface shadow-md";

/** Small rounded pill (BRAND.md: pills fully rounded). */
export const pill =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold";

/** Yellow "HD" / "4K" style badge (BRAND.md: sun for quality badges). */
export const badgeSun =
  "inline-flex items-center rounded-full bg-sun px-2 py-0.5 text-xs font-black tracking-wide text-ink";
