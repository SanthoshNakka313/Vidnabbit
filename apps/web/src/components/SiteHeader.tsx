"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { IconMenu, IconX } from "./icons";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/supported-sites", label: "Supported sites" },
  { href: "/how-it-works", label: "How it works" },
];

const navLink =
  "inline-flex items-center min-h-tap px-3 rounded-md text-text font-medium hover:bg-surface-2";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
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
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="hidden sm:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={navLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sm:hidden">
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-tap items-center gap-2 rounded-md px-3 font-medium hover:bg-surface-2"
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
        className="border-t border-border px-4 pb-3 pt-2 sm:hidden"
      >
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={`${navLink} w-full`} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
