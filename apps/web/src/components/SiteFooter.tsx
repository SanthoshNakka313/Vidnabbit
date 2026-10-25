import Link from "next/link";

type FooterLink = { href: string; label: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "VidNabbit",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/supported-sites", label: "Supported sites" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/copyright", label: "Copyright & takedown" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

const footerLink =
  "inline-flex min-h-tap items-center rounded-sm text-white/75 transition-colors hover:text-white sm:min-h-8";

/** Dark ink footer with the dark-background logo (BRAND.md logo table). */
export function SiteFooter({ guides = [] }: { guides?: FooterLink[] }) {
  const columns = guides.length ? [COLUMNS[0], { title: "Guides", links: guides }, COLUMNS[1]] : COLUMNS;
  return (
    <footer className="mt-auto bg-ink text-white">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-4">
          <Link href="/" className="inline-flex self-start rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
            <img
              src="/brand/vidnabbit-logo-horizontal-dark.svg"
              alt="VidNabbit home"
              width={417}
              height={120}
              className="h-10 w-auto"
            />
          </Link>
          <p className="max-w-xs text-white/75">Paste it. Nab it. Save media you own or have the right to download.</p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title === "VidNabbit" ? "Product" : col.title}>
            <h2 className="mb-3 text-sm font-black uppercase tracking-widest text-sun">{col.title}</h2>
            <ul className="flex flex-col gap-1">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={footerLink}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-6 text-sm text-white/70 sm:flex-row sm:justify-between sm:px-6">
          <p>VidNabbit does not host content. Files are deleted within 1 hour. No DRM bypassing, ever.</p>
          <p>Not affiliated with any site we support. © VidNabbit</p>
        </div>
      </div>
    </footer>
  );
}
