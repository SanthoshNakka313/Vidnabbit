import type { Metadata } from "next";
import { SITE_NAME } from "./config";

/**
 * Site-wide SEO constants. NEXT_PUBLIC_SITE_URL is inlined at build time;
 * set it per environment (e.g. a preview domain). No trailing slash.
 */
export const DEFAULT_SITE_URL = "https://vidnabbit.com";

function normaliseSiteUrl(value: string | undefined): string {
  try {
    return new URL(value || DEFAULT_SITE_URL).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const SITE_URL = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/**
 * Set NEXT_PUBLIC_NOINDEX=1 on staging/preview deployments so they are never
 * indexed (robots.txt disallows everything and every page gets noindex).
 */
export const SITE_INDEXABLE = process.env.NEXT_PUBLIC_NOINDEX !== "1";

export { SITE_NAME };
export const SITE_TAGLINE = "Paste it. Nab it.";
export const SITE_TITLE = "VidNabbit: free downloader for video, audio and images";
export const SITE_DESCRIPTION =
  "Save video, audio and images you own or have the right to download. Paste a link, pick MP4, MP3, M4A or the original image, and nab it. Free, no sign-up.";
export const SITE_LOCALE = "en_US";
/** Public contact for legal, privacy and abuse (forwarded by Cloudflare Email Routing). */
export const CONTACT_EMAIL = "abuse@vidnabbit.com";
/** Shown as "Last updated" on the Terms, Privacy and Copyright pages. */
export const LEGAL_UPDATED = "27 October 2026";
export const SOCIAL_IMAGE_ALT =
  "VidNabbit logo with the tagline: Paste it. Nab it. Save video, audio and images you own or have the right to download.";
/**
 * Social image: the static public/og.png (1200x630, brand logo file + Nunito;
 * static so it works on Cloudflare Workers, which have no filesystem). Pages
 * that set their own openGraph/twitter objects replace the inherited image, so
 * pageMetadata() adds these back explicitly.
 */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT, type: "image/png" };
export const TWITTER_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT, type: "image/png" };
export const BRAND_COLOR = "#F43F5E";
export const BRAND_BACKGROUND = "#FAF8FC";
export const BRAND_INK = "#1E1B2E";

/** Absolute URL for a site path ("/faq" -> "https://vidnabbit.com/faq"). */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * Home page metadata. In src/app/page.tsx:
 *   export { homeMetadata as metadata } from "@/lib/site";
 * or `export const metadata = homeMetadata;`
 */
export const homeMetadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

export interface PageSeo {
  /** Page title without the brand suffix (the layout template adds it). */
  title: string;
  description: string;
  /** Canonical path, starting with "/". */
  path: string;
  /** "article" for guides, "website" otherwise. */
  type?: "website" | "article";
  /** Set true for pages that must never be indexed. */
  noindex?: boolean;
}

/**
 * Builds consistent per-page metadata: canonical, Open Graph and Twitter.
 * The Open Graph / Twitter images point at the static /og.png.
 */
export function pageMetadata({ title, description, path, type = "website", noindex }: PageSeo): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      url: path,
      title: `${title} · ${SITE_NAME}`,
      description,
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · ${SITE_NAME}`,
      description,
      images: [TWITTER_IMAGE],
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export interface SiteLink {
  href: string;
  label: string;
}

export interface GuideEntry extends SiteLink {
  /** One-line summary used on the guides index and in related links. */
  summary: string;
  /** ISO date the guide was first published. */
  published: string;
  /** ISO date the guide content last changed. Update when you edit it. */
  updated: string;
}

/** Help guides, in the order they are listed on /guides. */
export const guides: GuideEntry[] = [
  {
    href: "/guides/save-your-own-uploads",
    label: "Back up your own uploads",
    summary: "Keep a copy of the videos, audio and photos you have posted publicly.",
    published: "2026-10-25",
    updated: "2026-10-25",
  },
  {
    href: "/guides/download-creative-commons-videos",
    label: "Download Creative Commons videos",
    summary: "Find openly licensed videos, check the licence and credit the creator.",
    published: "2026-10-25",
    updated: "2026-10-25",
  },
  {
    href: "/guides/mp4-vs-mp3-formats",
    label: "MP4 vs MP3 (and M4A)",
    summary: "Which format to pick for video, music, podcasts and lectures.",
    published: "2026-10-25",
    updated: "2026-10-25",
  },
  {
    href: "/guides/is-it-legal-to-download-videos",
    label: "Is it legal to download videos?",
    summary: "A plain-English overview of when saving media is usually fine, and when it isn't.",
    published: "2026-10-25",
    updated: "2026-10-25",
  },
];

/**
 * Footer links, grouped. The UI should render every group; the order is the
 * suggested display order. Labels are short enough for a mobile footer.
 */
export const footerLinkGroups: { heading: string; links: SiteLink[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/formats", label: "Formats and quality" },
      { href: "/supported-sites", label: "Supported sites" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    heading: "Guides",
    links: [{ href: "/guides", label: "All guides" }, ...guides.map(({ href, label }) => ({ href, label }))],
  },
  {
    heading: "Legal",
    links: [
      { href: "/copyright", label: "Copyright & takedown" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

/**
 * Guide links for the footer "Guides" column (SiteFooter `guides` prop).
 * Includes the /formats explainer and the /guides index.
 */
export const footerGuides: SiteLink[] = [
  ...guides.map(({ href, label }) => ({ href, label })),
  { href: "/formats", label: "Formats and quality" },
  { href: "/guides", label: "All guides" },
];

/** Flat list of every footer link (for a single-row footer). */
export const footerLinks: SiteLink[] = footerLinkGroups.flatMap((g) => g.links);

/** Indexable routes for the sitemap, with a rough priority. */
export const sitemapRoutes: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly"; lastModified?: string }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/formats", priority: 0.8, changeFrequency: "monthly" },
  { path: "/supported-sites", priority: 0.8, changeFrequency: "weekly" },
  { path: "/faq", priority: 0.7, changeFrequency: "monthly" },
  { path: "/guides", priority: 0.7, changeFrequency: "monthly" },
  ...guides.map((g) => ({ path: g.href, priority: 0.6, changeFrequency: "monthly" as const, lastModified: g.updated })),
  { path: "/copyright", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];
