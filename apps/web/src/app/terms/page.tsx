import type { Metadata } from "next";
import Link from "next/link";
import { DraftBanner, PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <PageShell>
      <h1>Terms of use</h1>
      <DraftBanner />
      <p>Last updated: placeholder date. These terms are a working draft.</p>

      <h2>1. What VidNabbit is</h2>
      <p>
        VidNabbit is a free tool that converts media from public web pages into files you can save.
        We do not host content. Files are produced when you ask for them and deleted automatically
        within 1 hour.
      </p>

      <h2>2. Your responsibility</h2>
      <p>
        Only download content you own or have permission to use. That means content you created,
        content licensed for download (such as Creative Commons), or content you have the
        owner&apos;s permission to use. You are responsible for how you use any file you download.
      </p>

      <h2>3. What you must not do</h2>
      <ul>
        <li>Use VidNabbit to infringe copyright or other rights.</li>
        <li>Try to download DRM-protected, private, or sign-in-only content.</li>
        <li>Automate requests, bypass rate limits or the bot check, or overload the service.</li>
        <li>Use VidNabbit to reach private networks or systems you aren&apos;t allowed to access.</li>
      </ul>

      <h2>4. Rights holders</h2>
      <p>
        Rights holders can ask us to block content or exclude their site. See{" "}
        <Link href="/copyright">Copyright and takedown</Link>.
      </p>

      <h2>5. No warranty</h2>
      <p>
        VidNabbit is provided &quot;as is&quot;, without any warranty. We may change, limit or stop
        the service at any time.
      </p>

      <h2>6. Changes</h2>
      <p>We may update these terms. The date above shows the latest version.</p>
    </PageShell>
  );
}
