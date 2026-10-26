import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { GuideHeader, RelatedGuides, UpdatedLine, guideByHref } from "@/app/_seo/content-parts";
import { pageMetadata } from "@/lib/site";

const guide = guideByHref("/guides/is-it-legal-to-download-videos");
const description =
  "A balanced overview of when downloading videos is usually allowed (your own, licensed or public-domain media) and when it isn't. Not legal advice.";

export const metadata: Metadata = pageMetadata({
  title: "Is it legal to download videos? Plain-English guide",
  description,
  path: guide.href,
  type: "article",
});

export default function Page() {
  return (
    <PageShell>
      <GuideHeader guide={guide} description={description} />
      <h1>Is it legal to download videos?</h1>
      <UpdatedLine guide={guide} />
      <p>
        <strong>This is general information, not legal advice.</strong> Laws differ from country to
        country and change over time. If you need a firm answer for your situation, ask a qualified
        lawyer.
      </p>
      <p>
        <strong>Short answer:</strong> it depends on who owns the video and what they allow.
        Downloading is a form of copying, and copying someone else&apos;s work generally needs their
        permission, a licence or a legal exception.
      </p>

      <h2>Usually fine</h2>
      <ul>
        <li>
          <strong>Your own work.</strong> Videos, audio and photos you created and uploaded.
        </li>
        <li>
          <strong>Public-domain media.</strong> Works whose copyright has expired or that were
          dedicated to the public domain (for example with CC0).
        </li>
        <li>
          <strong>Openly licensed media.</strong> Creative Commons and similar licences allow copying,
          on conditions such as crediting the creator. See{" "}
          <Link href="/guides/download-creative-commons-videos">how to download Creative Commons videos</Link>.
        </li>
        <li>
          <strong>With permission.</strong> When the owner has told you, ideally in writing, that you
          can download and use it.
        </li>
        <li>
          <strong>Direct file links offered for download</strong>, such as a press kit or a file a
          site shares for you to save.
        </li>
      </ul>

      <h2>Usually not fine</h2>
      <ul>
        <li>Copyrighted films, shows, music videos or sports without the owner&apos;s permission.</li>
        <li>Anything protected by DRM: getting around copy protection is illegal in many countries.</li>
        <li>Paid, subscription or members-only content.</li>
        <li>Re-uploading someone else&apos;s video as your own, or using it commercially without a licence.</li>
      </ul>

      <h2>The grey areas</h2>
      <p>
        Some countries have exceptions such as &quot;fair use&quot; (United States) or &quot;fair
        dealing&quot; and private-copying rules (some other countries) that can cover things like
        criticism, teaching or research. They are narrow, they differ a lot between places, and they
        are decided case by case. Don&apos;t assume one applies without checking.
      </p>
      <p>
        A platform&apos;s terms of service can also limit downloading, even when copyright law
        might not. Check them for the site you&apos;re using.
      </p>

      <h2>How VidNabbit helps you stay on the right side</h2>
      <ul>
        <li>We only work with sites that allow downloading, and never ask for passwords or cookies.</li>
        <li>We never bypass DRM, and we refuse DRM-protected services.</li>
        <li>
          Rights holders can block their content through our{" "}
          <Link href="/copyright">copyright and takedown page</Link>.
        </li>
        <li>We don&apos;t host content: files are deleted after 1 hour.</li>
      </ul>
      <p>
        You are still responsible for what you download. Our <Link href="/terms">Terms</Link> ask you
        to download only media you own or have permission to use.
      </p>

      <h2>A quick checklist</h2>
      <ol>
        <li>Did I make it? If yes, go ahead.</li>
        <li>Is it public domain or under a licence that allows copying? Follow the licence terms.</li>
        <li>Do I have the owner&apos;s permission? Keep a record of it.</li>
        <li>None of the above? Don&apos;t download it. Watch or share the original link instead.</li>
      </ol>

      <RelatedGuides current={guide.href} />
    </PageShell>
  );
}
