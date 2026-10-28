import Link from "next/link";
import type { ComponentType } from "react";
import { IconDownload, IconFileText, IconImage, IconResume, IconSparkle } from "../icons";

interface Tab {
  href: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

/** A pill switch between sibling tool pages (real links, so each is its own page). */
export function ToolTabs({ label, tabs, current }: { label: string; tabs: readonly Tab[]; current: string }) {
  return (
    <nav aria-label={label} className="flex justify-center">
      <ul className="inline-flex gap-1 rounded-full border border-border bg-surface p-1 shadow-sm">
        {tabs.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={href === current ? "page" : undefined}
              className="inline-flex min-h-tap items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-bold sm:gap-2 sm:px-4 sm:text-base text-text/80 transition-colors hover:bg-surface-2 hover:text-text aria-[current=page]:bg-ink aria-[current=page]:text-white sm:px-5 dark:aria-[current=page]:bg-white dark:aria-[current=page]:text-ink"
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

const CONVERT_TABS = [
  { href: "/convert/images", label: "Images", Icon: IconImage },
  { href: "/convert/documents", label: "Documents", Icon: IconFileText },
] as const;

/** The Images / Documents switch at the top of both converter pages. */
export function ConvertTabs({ current }: { current: (typeof CONVERT_TABS)[number]["href"] }) {
  return <ToolTabs label="Converters" tabs={CONVERT_TABS} current={current} />;
}

export const RESUME_TABS = [
  { href: "/resume/ats-checker", label: "ATS checker", Icon: IconResume },
  { href: "/resume/humanizer", label: "Humanizer", Icon: IconSparkle },
  { href: "/resume/pdf", label: "To PDF", Icon: IconDownload },
] as const;

/** The ATS checker / Humanizer switch on the ResuNabbit pages. */
export function ResumeTabs({ current }: { current: (typeof RESUME_TABS)[number]["href"] }) {
  return <ToolTabs label="Resume tools" tabs={RESUME_TABS} current={current} />;
}
