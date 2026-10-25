import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { connection } from "next/server";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteGraph } from "@/components/seo/schema";
import {
  BRAND_BACKGROUND,
  footerGuides,
  SITE_DESCRIPTION,
  SITE_INDEXABLE,
  SITE_LOCALE,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

// BRAND.md: Nunito 400 / 700 / 900, self-hosted by next/font (no Google request at runtime).
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
});

// SEO: defaults for every page. Pages set their own title, description and
// canonical via pageMetadata() in src/lib/site.ts. Icons, manifest and social
// images come from the app/ file conventions (icon.svg, apple-icon.png,
// favicon.ico, manifest.ts, opengraph-image.tsx, twitter-image.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "multimedia",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: SITE_LOCALE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: SITE_INDEXABLE
    ? {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
      }
    : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_BACKGROUND },
    { media: "(prefers-color-scheme: dark)", color: "#14121F" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render per request so the CSP nonce from proxy.ts is applied to scripts.
  await connection();
  return (
    <html lang="en" className={`${nunito.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-2 z-50 rounded-md bg-ink px-4 py-3 font-bold text-white"
        >
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter guides={footerGuides} />
        <JsonLd data={siteGraph()} />
      </body>
    </html>
  );
}
