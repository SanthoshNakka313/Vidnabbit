/**
 * Shared class strings for the button variants in docs/04-design.md §5.
 * Kept as strings (not a component) so they work on <button>, <a> and <Link>.
 */
const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 font-medium text-base min-h-control min-w-tap " +
  "transition-colors duration-150 ease-vn select-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed";

export const buttonPrimary = `${base} bg-accent text-on-accent hover:bg-accent-hover enabled:active:bg-accent-hover shadow-sm`;

export const buttonSecondary = `${base} bg-surface text-text border border-strong hover:bg-surface-2`;

export const buttonGhost = `${base} text-accent hover:bg-surface-2 underline-offset-2 hover:underline`;

export const linkInline =
  "text-accent underline underline-offset-2 hover:text-accent-hover rounded-sm";

export const inputBase =
  "w-full rounded-md border border-strong bg-bg text-text text-base px-4 placeholder:text-muted " +
  "aria-invalid:border-danger shadow-sm";

export const card = "rounded-lg border border-border bg-surface shadow-md";
