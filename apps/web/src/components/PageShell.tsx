import type { ReactNode } from "react";
import { IconAlert } from "./icons";

/** Narrow reading column for info and legal pages, on a soft brand backdrop. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="vn-hero-glow">
      <div className="mx-auto w-full max-w-content px-4 py-12 sm:px-6 sm:py-16">
        <article className="prose-vn rounded-xl border border-border bg-surface p-6 shadow-md sm:p-10">
          {children}
        </article>
      </div>
    </div>
  );
}

/** Banner for placeholder legal text that has not been reviewed. */
export function DraftBanner() {
  return (
    <div
      role="note"
      className="mb-6 flex items-start gap-3 rounded-lg border-2 border-sun bg-warning-subtle p-4 text-warning"
    >
      <IconAlert className="mt-0.5 shrink-0" />
      <p className="mb-0! font-bold">
        Draft — needs legal review. This placeholder text is not legal advice and is not yet in effect.
      </p>
    </div>
  );
}
