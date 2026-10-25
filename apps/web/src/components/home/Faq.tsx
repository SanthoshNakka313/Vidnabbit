/** Native <details> accordion: keyboard and screen-reader friendly, no JS. */
export function Faq({ items, headingId = "faq-heading" }: { items: { q: string; a: string }[]; headingId?: string }) {
  return (
    <section aria-labelledby={headingId} className="mx-auto w-full max-w-content">
      <h2 id={headingId} className="mb-2 text-center text-2xl sm:text-3xl">
        Questions, answered
      </h2>
      <p className="mb-8 text-center text-muted">Short answers. No fine-print burrows.</p>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <details
            key={item.q}
            className="group rounded-lg border border-border bg-surface shadow-sm open:shadow-md"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden="true"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xl font-black text-accent-strong transition-transform duration-200 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="px-5 pb-5 text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
