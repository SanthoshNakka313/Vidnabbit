import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { GuideHeader, RelatedGuides, UpdatedLine, guideByHref } from "@/app/_seo/content-parts";
import { pageMetadata } from "@/lib/site";

const guide = guideByHref("/guides/download-creative-commons-videos");
const description =
  "Find Creative Commons and public-domain videos, check the licence before you download, and credit the creator correctly. A practical guide.";

export const metadata: Metadata = pageMetadata({
  title: "How to download Creative Commons videos",
  description,
  path: guide.href,
  type: "article",
});

export default function Page() {
  return (
    <PageShell>
      <GuideHeader guide={guide} description={description} />
      <h1>How to download Creative Commons videos</h1>
      <UpdatedLine guide={guide} />
      <p>
        Creative Commons (CC) licences let creators share their work so others can copy and reuse
        it, on certain conditions. That makes CC and public-domain videos a great fit for lessons,
        presentations, research and remixes. Here&apos;s how to find them, check them and save them.
      </p>

      <h2>Where to find openly licensed videos</h2>
      <ul>
        <li>
          <strong>Wikimedia Commons</strong>: a large library of freely licensed media, each with its
          licence on the file page.
        </li>
        <li>
          <strong>Internet Archive</strong>: public-domain films, lectures and recordings, many with a
          licence noted on the item page.
        </li>
        <li>
          <strong>Video platforms</strong>: some let creators mark uploads as Creative Commons. Look
          for the licence in the description or details.
        </li>
        <li>
          <strong>Openverse</strong>: a search engine for openly licensed works.
        </li>
      </ul>

      <h2>Check the licence before you download</h2>
      <p>Every CC licence asks you to credit the creator. Some add more conditions:</p>
      <ul>
        <li>
          <strong>BY</strong>: credit the creator. That&apos;s it.
        </li>
        <li>
          <strong>SA</strong> (ShareAlike): if you change it and share it, use the same licence.
        </li>
        <li>
          <strong>NC</strong> (NonCommercial): no commercial use.
        </li>
        <li>
          <strong>ND</strong> (NoDerivatives): share it as it is, without changes.
        </li>
        <li>
          <strong>CC0 / public domain</strong>: no conditions, though a credit is still kind.
        </li>
      </ul>
      <p>
        Check the licence on the original page, not a re-upload: someone re-sharing a video
        doesn&apos;t make it theirs to license.
      </p>

      <h2>Save it with VidNabbit</h2>
      <ol>
        <li>Copy the address of the page with the video.</li>
        <li>
          Paste it into <Link href="/download">VidNabbit</Link> and press <strong>Nab it</strong>.
        </li>
        <li>
          Pick a format. MP4 720p is a good default for classrooms; pick Best if you&apos;ll edit it.
          See <Link href="/formats">formats and quality</Link>.
        </li>
        <li>Save the file within 3 minutes, before the link expires.</li>
      </ol>

      <h2>Credit the creator</h2>
      <p>
        A good credit follows the &quot;TASL&quot; pattern: <strong>T</strong>itle,{" "}
        <strong>A</strong>uthor, <strong>S</strong>ource (a link) and <strong>L</strong>icence (with
        a link to it). For example:
      </p>
      <p>
        <em>&quot;Ocean Waves at Dawn&quot; by Jane Doe, from Wikimedia Commons, licensed CC BY 4.0.</em>
      </p>
      <p>Put the credit near where the video is used: in the slide, the description or the end credits.</p>

      <RelatedGuides current={guide.href} />
    </PageShell>
  );
}
