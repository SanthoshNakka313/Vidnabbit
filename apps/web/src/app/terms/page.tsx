import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_UPDATED, pageMetadata } from "@/lib/site";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = pageMetadata({
  title: "Terms of use",
  description:
    "The rules for using VidNabbit: only download media you own or have permission to use, no DRM or sign-in content, and fair use of the service.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <PageShell>
      <h1>Terms of use</h1>
      <p>Last updated: {LEGAL_UPDATED}</p>
      <p>
        These terms apply when you use vidnabbit.com (&quot;VidNabbit&quot;, &quot;we&quot;). By
        using VidNabbit you agree to them. If you don&apos;t agree, please don&apos;t use the
        service.
      </p>

      <h2>1. What VidNabbit is</h2>
      <p>
        VidNabbit is a free tool that turns media from public web pages into files you can save. We
        don&apos;t host or index content and there is no gallery to browse. A file is made only when
        you ask for it and is deleted automatically within 1 hour.
      </p>

      <h2>2. Who can use it</h2>
      <p>
        You must be at least 13 years old, or older if the law where you live requires it, to use
        VidNabbit.
      </p>

      <h2>3. Your responsibility</h2>
      <p>
        Only download content you own or have permission to use: content you created, content
        licensed for download (such as Creative Commons or public domain), or content you have the
        owner&apos;s permission to save. Many sites have their own terms about downloading, and you
        are responsible for following them. You are responsible for what you download and how you
        use it.
      </p>

      <h2>4. What you must not do</h2>
      <ul>
        <li>Use VidNabbit to infringe copyright or anyone else&apos;s rights.</li>
        <li>Try to download DRM-protected, private, paid or sign-in-only content.</li>
        <li>Automate requests, get around the rate limits or the bot check, or overload the service.</li>
        <li>Use VidNabbit to reach private networks or systems you aren&apos;t allowed to access.</li>
        <li>Use VidNabbit for anything illegal.</li>
      </ul>
      <p>We may block access for anyone who breaks these terms, including repeat infringers.</p>

      <h2>5. Rights holders</h2>
      <p>
        Rights holders can ask us to block content or exclude their whole site. See{" "}
        <Link href="/copyright">Copyright and takedown</Link>.
      </p>

      <h2>6. No warranty</h2>
      <p>
        VidNabbit is provided free and &quot;as is&quot;, without any warranty. Sites change often,
        so some links won&apos;t work. We may change, limit or stop the service, or any part of it, at
        any time.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the extent the law allows, we are not liable for any indirect or consequential loss, or
        for any loss arising from what you download or how you use it. Nothing in these terms limits
        liability that cannot be limited by law.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update these terms. The date at the top shows the latest version, and continuing to
        use VidNabbit after a change means you accept it.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See
        also our <Link href="/privacy">Privacy policy</Link>.
      </p>
    </PageShell>
  );
}
