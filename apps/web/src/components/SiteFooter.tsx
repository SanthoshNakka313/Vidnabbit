import Link from "next/link";

const LINKS = [
  { href: "/copyright", label: "Copyright & takedown" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/supported-sites", label: "Supported sites" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 text-sm text-muted sm:px-6">
        <nav aria-label="Footer">
          <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-2">
            {LINKS.map((l, i) => (
              <li key={l.href} className="flex items-center">
                <Link
                  href={l.href}
                  className="inline-flex min-h-tap items-center rounded-sm text-text underline-offset-2 hover:underline sm:min-h-0"
                >
                  {l.label}
                </Link>
                {i < LINKS.length - 1 && (
                  <span aria-hidden="true" className="ml-2 hidden sm:inline">
                    ·
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p>VidNabbit does not host content. Files are deleted within 1 hour.</p>
        <p>Not affiliated with any site we support.</p>
        <p>© VidNabbit</p>
      </div>
    </footer>
  );
}
