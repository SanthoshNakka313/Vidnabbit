import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_UPDATED, pageMetadata } from "@/lib/site";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "What VidNabbit processes and for how long: no accounts, no ads, no tracking scripts, hashed IPs for rate limits, and files deleted within 1 hour.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <PageShell>
      <h1>Privacy</h1>
      <p>Last updated: {LEGAL_UPDATED}</p>

      <h2>The short version</h2>
      <ul>
        <li>No accounts, no sign-up, no ads and no third-party tracking or analytics scripts.</li>
        <li>We never ask for, store or use your passwords, cookies or login sessions for other sites.</li>
        <li>Downloaded files are deleted automatically within 1 hour.</li>
        <li>We don&apos;t sell or share your personal information.</li>
      </ul>

      <h2>What we process, why, and for how long</h2>
      <ul>
        <li>
          <strong>The link you paste</strong>, to find the media and prepare your file. It is kept
          only while your download is prepared and for at most 2 hours after. Our server logs record
          the site&apos;s name (for example &quot;youtube.com&quot;), never the full link.
        </li>
        <li>
          <strong>Your IP address</strong>, to apply fair-use limits and protect the service from
          abuse. We store it only in hashed form, for the length of the rate-limit window (at most a
          day), and in server logs that are kept for a short time to keep the service secure.
        </li>
        <li>
          <strong>The file you download</strong>, stored only so you can fetch it, then deleted
          automatically within 1 hour.
        </li>
        <li>
          <strong>Takedown requests</strong>: if you send one, we keep your name, email,
          organisation and the details you give us, so we can handle the request and keep the records
          the law requires. We keep these for 3 years.
        </li>
      </ul>
      <p>
        We process this data because we have a legitimate interest in running a safe and fair
        service, and, for takedown records, to meet our legal obligations.
      </p>

      <h2>Cookies</h2>
      <p>
        VidNabbit doesn&apos;t set cookies of its own. Cloudflare, which protects the site, may set
        strictly necessary security cookies to tell people from bots. There are no advertising or
        tracking cookies.
      </p>

      <h2>Service providers</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> delivers the website, runs the Turnstile bot check before
          downloads, stores files for up to 1 hour (R2) and forwards email. Cloudflare processes
          technical data about your browser to do this, under its own privacy policy.
        </li>
        <li>
          <strong>Hetzner</strong> hosts our servers in Germany.
        </li>
        <li>
          <strong>Thumbnails</strong> in the preview load directly from the source site, so that site
          can see your IP address. We send no referrer with these requests.
        </li>
      </ul>
      <p>
        Some of these providers may process data outside your country. They are bound to protect
        it under their own terms and the law.
      </p>

      <h2>Children</h2>
      <p>VidNabbit is not meant for children under 13, and we don&apos;t knowingly collect their data.</p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct or delete your data,
        to object to how we use it, and to complain to your data protection authority. Because we
        don&apos;t have accounts and only keep hashed IPs for a short time, there is usually nothing
        we can link to you. For takedown records, email us and we&apos;ll help.
      </p>

      <h2>Changes</h2>
      <p>We may update this policy. The date at the top shows the latest version.</p>

      <h2>Contact</h2>
      <p>
        Privacy questions and requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </PageShell>
  );
}
