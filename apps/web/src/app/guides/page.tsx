import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/app/_seo/content-parts";
import { guides, pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Guides: saving media the right way",
  description:
    "Practical guides: back up your own uploads, download Creative Commons videos, choose between MP4, MP3 and M4A, and learn when downloading is allowed.",
  path: "/guides",
});

export default function GuidesPage() {
  return (
    <PageShell>
      <Breadcrumbs trail={[{ name: "Guides", path: "/guides" }]} />
      <h1>Guides</h1>
      <p>
        Short, practical help for saving media you own or have the right to download. No fluff, no
        jargon.
      </p>
      <ul>
        {guides.map((g) => (
          <li key={g.href}>
            <Link href={g.href}>{g.label}</Link>: {g.summary}
          </li>
        ))}
        <li>
          <Link href="/formats">Formats and quality</Link>: every option VidNabbit offers, explained.
        </li>
      </ul>
      <p>
        Looking for a quick answer instead? Try the <Link href="/faq">FAQ</Link>.
      </p>
    </PageShell>
  );
}
