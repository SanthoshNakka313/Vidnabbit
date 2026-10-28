"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ProductIcon, ProductName, type ProductId } from "./hub/products";
import { IconChevronDown, IconMenu, IconX } from "./icons";
import { Wordmark } from "./Wordmark";

interface NavLink {
  href: string;
  label: string;
  blurb?: string;
}

interface NavItem {
  label: string;
  /** A plain link, or a product with a menu of its tools. */
  href?: string;
  product?: ProductId;
  /** Highlight this item on every path starting with this. */
  match: string;
  links?: NavLink[];
}

const NAV: NavItem[] = [
  { label: "VidNabbit", href: "/download", product: "vidnabbit", match: "/download" },
  {
    label: "Convabbit",
    product: "convabbit",
    match: "/convert",
    links: [
      { href: "/convert/images", label: "Image converter", blurb: "JPG, PNG, WebP, HEIC, AVIF, SVG and more" },
      { href: "/convert/documents", label: "Word & PDF tools", blurb: "Word to PDF, PDF to Word, merge PDFs" },
    ],
  },
  {
    label: "ResuNabbit",
    product: "resunabbit",
    match: "/resume",
    links: [
      { href: "/resume/ats-checker", label: "ATS score checker", blurb: "Score your resume against a job ad" },
      { href: "/resume/humanizer", label: "Resume humanizer", blurb: "Replace buzzwords and AI-sounding phrases" },
      { href: "/resume/pdf", label: "Resume to PDF", blurb: "Pick a template and download PDF or Word" },
    ],
  },
  { label: "How it works", href: "/how-it-works", match: "/how-it-works" },
  { label: "Supported sites", href: "/supported-sites", match: "/supported-sites" },
  { label: "FAQ", href: "/faq", match: "/faq" },
];

const navLink =
  "inline-flex items-center gap-1 min-h-tap px-3.5 rounded-full font-bold text-text/80 transition-colors " +
  "hover:text-text hover:bg-surface-2 aria-[current=page]:text-text aria-[current=page]:bg-accent-subtle";

/** Desktop dropdown for one product: a button that opens a short list of its tools. */
function ProductMenu({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const current = pathname.startsWith(item.match);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <li
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((o) => !o)}
        className={navLink}
      >
        {item.label}
        <IconChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-1/2 top-full z-50 mt-2 w-80 -translate-x-1/2 rounded-xl border border-border bg-surface p-2 shadow-lg"
      >
        <p className="flex items-center gap-2 px-3 pb-2 pt-1.5">
          <ProductIcon id={item.product!} size="sm" />
          <ProductName id={item.product!} />
        </p>
        <ul>
          {item.links!.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex flex-col rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2 aria-[current=page]:bg-accent-subtle"
              >
                <span className="font-bold">{l.label}</span>
                {l.blurb && <span className="text-sm text-muted">{l.blurb}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

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
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) =>
              item.links ? (
                <ProductMenu key={item.label} item={item} pathname={pathname} />
              ) : (
                <li key={item.label}>
                  <Link href={item.href!} aria-current={pathname.startsWith(item.match) ? "page" : undefined} className={navLink}>
                    {item.label}
                  </Link>
                </li>
              ),
            )}
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
        <div className="lg:hidden">
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
      <nav id={menuId} aria-label="Main" hidden={!open} className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border px-4 pb-4 pt-2 lg:hidden">
        <ul className="flex flex-col gap-1">
          {NAV.map((item) =>
            item.links ? (
              <li key={item.label} className="mt-1 rounded-lg bg-surface-2/60 p-2">
                <p className="flex items-center gap-2 px-1.5 pb-1">
                  <ProductIcon id={item.product!} size="sm" />
                  <ProductName id={item.product!} />
                </p>
                <ul className="flex flex-col">
                  {item.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined} className={`${navLink} w-full`} onClick={() => setOpen(false)}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={item.label}>
                <Link
                  href={item.href!}
                  aria-current={pathname.startsWith(item.match) ? "page" : undefined}
                  className={`${navLink} w-full`}
                  onClick={() => setOpen(false)}
                >
                  {item.product && <ProductIcon id={item.product} size="sm" />}
                  {item.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
    </header>
  );
}
