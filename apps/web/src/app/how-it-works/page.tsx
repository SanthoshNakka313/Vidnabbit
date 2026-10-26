import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import Link from "next/link";
import { HowItWorksSteps } from "@/components/HowItWorksSteps";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = pageMetadata({
  title: "How it works",
  description:
    "Paste a link from a site that allows downloading, pick a format and save the file. See what happens to your download, the limits, and why some links are refused.",
  path: "/how-it-works",
});

export default function HowItWorksPage() {
  return (
    <PageShell>
      <h1>How VidNabbit works</h1>
      <div className="mb-8">
        <HowItWorksSteps headingLevel={2} />
      </div>

      <h2>What happens to my file?</h2>
      <p>
        We prepare the file on demand and give you a private download link. The file and the link
        are deleted automatically after 1 hour. We don&apos;t keep a gallery of downloads and
        nobody else can browse them.
      </p>

      <h2>Limits</h2>
      <ul>
        <li>Media up to 3 hours long</li>
        <li>Files up to 4 GB</li>
        <li>A quick bot check (Cloudflare Turnstile) before each download</li>
        <li>A fair-use limit on how many requests you can make in a short time</li>
      </ul>

      <h2>Why was my link refused?</h2>
      <p>
        We only work with public content. Links to DRM-protected services, private or members-only
        content, content behind a sign-in, live streams, and items removed at a rights
        holder&apos;s request are refused. See <Link href="/supported-sites">supported sites</Link>.
      </p>

      <h2>What can I download?</h2>
      <p>
        Only download content you own or have permission to use. That means content you created,
        content licensed for download (such as Creative Commons), or content you have the
        owner&apos;s permission to use.
      </p>
    </PageShell>
  );
}
