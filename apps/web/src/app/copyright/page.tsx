import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_UPDATED, pageMetadata } from "@/lib/site";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { TakedownForm } from "@/components/TakedownForm";

export const metadata: Metadata = pageMetadata({
  title: "Copyright & takedown",
  description:
    "Rights holders can ask VidNabbit to block links to their content or exclude a whole site. How takedowns work, plus the request form.",
  path: "/copyright",
});

export default function CopyrightPage() {
  return (
    <PageShell>
      <h1>Copyright and takedown</h1>
      <p>Last updated: {LEGAL_UPDATED}</p>
      <p>
        VidNabbit respects the rights of creators. We don&apos;t host content: files are produced
        on request from public pages and deleted automatically within 1 hour. We never bypass DRM
        and never process content that needs a sign-in. If you believe VidNabbit is being used to
        copy your work without permission, tell us and we&apos;ll act quickly.
      </p>

      <h2>How takedowns work</h2>
      <ol>
        <li>Send the form below with the links to the content you want blocked.</li>
        <li>We review the request and reply by email.</li>
        <li>
          Approved items are added to our blocklist. VidNabbit then refuses those links (and other
          addresses for the same item) for everyone.
        </li>
        <li>Any file already prepared for those items is deleted.</li>
      </ol>
      <p>
        Your request must identify the work, give the exact links, and include the two statements
        and your signature in the form. Sending a false or misleading request may make you liable
        for damages. Prefer email? Send the same details to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Excluding a whole site</h2>
      <p>
        If you own a website and want VidNabbit to refuse all links to it, send the form with your
        site&apos;s home page as the link and say so in your request. We may ask you to prove that
        you control the domain.
      </p>

      <h2>If your link was blocked by mistake</h2>
      <p>
        If you own the content or have permission to use it and think a block is a mistake, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the link, why you have the
        right to use it, and your contact details. We review these and may share them with the
        person who sent the request.
      </p>

      <h2>Users</h2>
      <p>
        Only download content you own or have permission to use. We block access for repeat
        infringers. See our <Link href="/terms">Terms</Link>.
      </p>

      <h2 id="takedown-form">Takedown request</h2>
      <p>All fields are required unless marked optional.</p>
      <TakedownForm />
    </PageShell>
  );
}
