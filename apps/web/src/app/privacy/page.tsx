import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { DraftBanner, PageShell } from "@/components/PageShell";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "VidNabbit privacy in plain English: no accounts, no ads, no tracking scripts, no passwords or cookies, and files deleted within 1 hour.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <PageShell>
      <h1>Privacy</h1>
      <DraftBanner />
      <p>Last updated: placeholder date. This policy is a working draft.</p>

      <h2>The short version</h2>
      <ul>
        <li>No accounts, no sign-up, no ads and no third-party tracking scripts.</li>
        <li>We never ask for, store or use your passwords, cookies or login sessions.</li>
        <li>Files are deleted automatically within 1 hour.</li>
      </ul>

      <h2>What we process</h2>
      <ul>
        <li>
          <strong>The link you paste</strong>, to find the media. It is kept only while your
          download is being prepared, and for at most a few hours after.
        </li>
        <li>
          <strong>Your IP address</strong>, to apply fair-use limits. We store it only in hashed or
          truncated form, and only for the length of the rate-limit window.
        </li>
        <li>
          <strong>Takedown requests</strong>: if you send one, we keep your name, email and the
          details you provide so we can process it and keep required records.
        </li>
      </ul>

      <h2>Third parties</h2>
      <ul>
        <li>
          <strong>Cloudflare Turnstile</strong> runs a bot check before downloads. Cloudflare
          processes technical data about your browser to do this, under its own privacy policy.
        </li>
        <li>
          <strong>Thumbnails</strong> in the preview are loaded directly from the source site, so
          that site can see your IP address. We send no referrer with these requests.
        </li>
        <li>
          <strong>Hosting and storage</strong> providers process data on our behalf to run the
          service.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access or delete your data. Because we
        don&apos;t keep accounts or identifiable logs, there is usually nothing we can link to you.
      </p>

      <h2>Contact</h2>
      <p>Contact details will be added before launch.</p>
    </PageShell>
  );
}
