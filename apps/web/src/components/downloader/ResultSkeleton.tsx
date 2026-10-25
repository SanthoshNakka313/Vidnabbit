"use client";

import { useEffect, useState } from "react";

const block = "rounded-md bg-surface-2 animate-pulse motion-reduce:animate-none";

/** Placeholder in the shape of the result; pulse is off under reduced motion. */
export function ResultSkeleton() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div data-testid="result-skeleton" className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-4 md:flex-row">
        <div className={`${block} aspect-video w-full rounded-lg md:w-72`} />
        <div className="flex flex-1 flex-col gap-2">
          <div className={`${block} h-5 w-11/12`} />
          <div className={`${block} h-5 w-2/3`} />
          <div className={`${block} mt-1 h-4 w-1/3`} />
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-2.5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${block} h-14`} />
        ))}
      </div>
      {slow && <p className="text-sm text-muted">Still hopping. Some sites take a little longer.</p>}
    </div>
  );
}
