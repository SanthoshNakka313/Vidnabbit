import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPage } from "@/components/seo/schema";
import { Breadcrumbs } from "@/app/_seo/content-parts";
import { homeFaq, moreFaqs, type FaqItem } from "@/lib/faq";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "FAQ: formats, limits, privacy and refused links",
  description:
    "Answers about VidNabbit: is it free, which formats you can pick, how long files are kept, why a link was refused, and what you're allowed to download.",
  path: "/faq",
});

function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <>
      {items.map((f) => (
        <section key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </section>
      ))}
    </>
  );
}

export default function FaqPage() {
  return (
    <PageShell>
      <Breadcrumbs trail={[{ name: "FAQ", path: "/faq" }]} />
      <h1>Frequently asked questions</h1>
      <p>
        Quick answers about nabbing media with VidNabbit. Can&apos;t find yours? Start with{" "}
        <Link href="/how-it-works">how it works</Link> or the list of{" "}
        <Link href="/supported-sites">supported sites</Link>.
      </p>

      <h2>The basics</h2>
      <FaqList items={homeFaq} />

      <h2>Formats, limits and privacy</h2>
      <FaqList items={moreFaqs} />

      <h2>Learn more</h2>
      <ul>
        <li>
          <Link href="/formats">Formats and quality</Link>: MP4, MP3, M4A and images, explained.
        </li>
        <li>
          <Link href="/guides/is-it-legal-to-download-videos">Is it legal to download videos?</Link>
        </li>
        <li>
          <Link href="/guides">All guides</Link>
        </li>
      </ul>
      {/* homeFaq is marked up on the home page; mark up the rest here only once. */}
      <JsonLd data={faqPage(moreFaqs)} />
    </PageShell>
  );
}
