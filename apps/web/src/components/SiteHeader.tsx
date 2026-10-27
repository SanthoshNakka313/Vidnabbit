"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { IconMenu, IconX } from "./icons";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/download", label: "VidNabbit" },
  { href: "/convert/images", label: "Convabbit", match: "/convert" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/supported-sites", label: "Supported sites" },
  { href: "/faq", label: "FAQ" },
];

/** "Convabbit" stays highlighted on both converter pages. */
function isCurrent(pathname: string, item: { href: string; match?: string }) {
  return item.match ? pathname.startsWith(item.match) : pathname === item.href;
}

const navLink =
  "inline-flex items-center min-h-tap px-3.5 rounded-full font-bold text-text/80 transition-colors " +
  "hover:text-text hover:bg-surface-2 aria-[current=page]:text-text aria-[current=page]:bg-accent-subtle";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(pathname, item) ? "page" : undefined}
                  className={navLink}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="ml-2">
              <Link
                href="/download#nab"
                className="inline-flex min-h-tap items-center rounded-full bg-ink px-5 font-bold text-white transition-transform hover:-translate-y-px dark:bg-white dark:text-ink"
              >
                Nab a link
              </Link>
            </li>
          </ul>
        </nav>
        <div className="md:hidden">
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-tap items-center gap-2 rounded-full px-4 font-bold hover:bg-surface-2"
          >
            {open ? <IconX /> : <IconMenu />}
            Menu
          </button>
        </div>
      </div>
      <nav
        id={menuId}
        aria-label="Main"
        hidden={!open}
        className="border-t border-border px-4 pb-4 pt-2 md:hidden"
      >
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent(pathname, item) ? "page" : undefined}
                className={`${navLink} w-full`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
