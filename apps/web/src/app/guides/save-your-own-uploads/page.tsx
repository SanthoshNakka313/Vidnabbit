import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { GuideHeader, RelatedGuides, UpdatedLine, guideByHref } from "@/app/_seo/content-parts";
import { pageMetadata } from "@/lib/site";

const guide = guideByHref("/guides/save-your-own-uploads");
const description =
  "How to back up videos, audio and photos you've posted publicly: pick the right quality, name your files and keep a safe copy, step by step.";

export const metadata: Metadata = pageMetadata({
  title: "How to back up your own uploads",
  description,
  path: guide.href,
  type: "article",
});

export default function Page() {
  return (
    <PageShell>
      <GuideHeader guide={guide} description={description} />
      <h1>How to back up your own uploads</h1>
      <UpdatedLine guide={guide} />
      <p>
        Accounts get locked, platforms shut down and old laptops die. If the only copy of your video,
        podcast episode or photo lives on someone else&apos;s site, it&apos;s worth keeping one of
        your own. Here&apos;s how to do it with VidNabbit in a minute or two.
      </p>

      <h2>Check the platform&apos;s own export first</h2>
      <p>
        Many sites let you download your original files or request an archive of your account. If
        that&apos;s available, use it: it often gives you the exact file you uploaded. VidNabbit is
        handy when there&apos;s no export, when it&apos;s slow, or when you only need a few items.
      </p>

      <h2>Back up a public upload, step by step</h2>
      <ol>
        <li>
          Open your post and make sure it&apos;s <strong>public</strong>. Tip: open the link in a
          private browser window. If it plays without signing in, VidNabbit can usually read it.
        </li>
        <li>Copy the page address from the address bar or the platform&apos;s Share button.</li>
        <li>
          Paste it into <Link href="/">VidNabbit</Link> and press <strong>Nab it</strong>.
        </li>
        <li>
          Pick <strong>Best</strong> for a master copy (up to 4K where your upload has it), or MP3 /
          M4A for audio-only posts.
        </li>
        <li>Download the file. The link works for about 1 hour, then the file is deleted from our side.</li>
      </ol>

      <h2>Private, unlisted or members-only posts</h2>
      <p>
        VidNabbit never asks for your password or cookies, so it can&apos;t see posts that need you
        to sign in. For those, use the platform&apos;s own download or export tool while signed in.
      </p>

      <h2>Keep your backup safe</h2>
      <ul>
        <li>
          <strong>Name files clearly</strong>, for example <code>2026-10-25 product launch.mp4</code>,
          so they sort by date.
        </li>
        <li>
          <strong>Keep a note of the source link</strong> and the date you posted it, in the file
          name or a simple spreadsheet.
        </li>
        <li>
          <strong>Follow the 3-2-1 idea:</strong> three copies, on two kinds of storage, with one
          kept somewhere else (for example a computer, an external drive and a cloud folder).
        </li>
      </ul>

      <h2>What quality will I get?</h2>
      <p>
        The best VidNabbit can offer is the best the platform still serves, which may be lower than
        the file you originally uploaded if the platform compressed it. That&apos;s another reason to
        keep your originals when you can. See <Link href="/formats">formats and quality</Link>.
      </p>

      <RelatedGuides current={guide.href} />
    </PageShell>
  );
}
