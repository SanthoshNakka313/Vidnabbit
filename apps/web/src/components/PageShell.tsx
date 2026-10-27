import type { ReactNode } from "react";

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

