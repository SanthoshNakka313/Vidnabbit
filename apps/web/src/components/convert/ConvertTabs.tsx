import Link from "next/link";
import { IconFileText, IconImage } from "../icons";

const TABS = [
  { href: "/convert/images", label: "Images", Icon: IconImage },
  { href: "/convert/documents", label: "Documents", Icon: IconFileText },
] as const;

/** The Images / Documents switch at the top of both converter pages (real links, so each is its own page). */
export function ConvertTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Converters" className="flex justify-center">
      <ul className="inline-flex gap-1 rounded-full border border-border bg-surface p-1 shadow-sm">
        {TABS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={href === current ? "page" : undefined}
              className="inline-flex min-h-tap items-center gap-2 rounded-full px-5 font-bold text-text/80 transition-colors hover:bg-surface-2 hover:text-text aria-[current=page]:bg-ink aria-[current=page]:text-white dark:aria-[current=page]:bg-white dark:aria-[current=page]:text-ink"
            >
              <Icon size={18} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
