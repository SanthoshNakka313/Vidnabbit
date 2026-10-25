import type { ReactNode } from "react";
import { IconAlert } from "./icons";

/** Narrow reading column for info and legal pages. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-10 sm:px-6 sm:py-14">
      <article className="prose-vn">{children}</article>
    </div>
  );
}

/** Banner for placeholder legal text that has not been reviewed. */
export function DraftBanner() {
  return (
    <div
      role="note"
      className="mb-6 flex items-start gap-3 rounded-lg border border-warning bg-warning-subtle p-4 text-warning"
    >
      <IconAlert className="mt-0.5 shrink-0" />
      <p className="mb-0! font-semibold">
        Draft — needs legal review. This placeholder text is not legal advice and is not yet in effect.
      </p>
    </div>
  );
}
