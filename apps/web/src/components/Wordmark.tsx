import Link from "next/link";
import { IconDownload } from "./icons";

/** Placeholder wordmark (docs/04-design.md §4) until the owner supplies a brand. */
export function Wordmark() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-tap items-center gap-2 rounded-md text-xl font-semibold text-text"
    >
      <span className="inline-flex size-5 items-center justify-center rounded-sm bg-accent text-on-accent">
        <IconDownload size={14} strokeWidth={2.5} />
      </span>
      VidNabbit
      <span className="sr-only"> home</span>
    </Link>
  );
}
