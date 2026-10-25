import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { GuideHeader, RelatedGuides, UpdatedLine, guideByHref } from "@/app/_seo/content-parts";
import { pageMetadata } from "@/lib/site";

const guide = guideByHref("/guides/mp4-vs-mp3-formats");
const description =
  "MP4 is video, MP3 and M4A are audio. Learn the difference, which one to pick for music, podcasts, lectures and editing, and how quality affects file size.";

export const metadata: Metadata = pageMetadata({
  title: "MP4 vs MP3 vs M4A: which format should you pick?",
  description,
  path: guide.href,
  type: "article",
});

export default function Page() {
  return (
    <PageShell>
      <GuideHeader guide={guide} description={description} />
      <h1>MP4 vs MP3 vs M4A: which format should you pick?</h1>
      <UpdatedLine guide={guide} />
      <p>
        <strong>Short answer:</strong> pick <strong>MP4</strong> when you want to watch it,{" "}
        <strong>MP3</strong> when you only want to listen and need it to play everywhere, and{" "}
        <strong>M4A</strong> when you only want to listen and care most about sound quality.
      </p>

      <h2>What each format is</h2>
      <ul>
        <li>
          <strong>MP4</strong> is a container for video and sound together. It plays on practically
          every phone, computer, TV and editing app.
        </li>
        <li>
          <strong>MP3</strong> is audio only. It&apos;s the oldest and most widely supported audio
          format, from car stereos to smart speakers.
        </li>
        <li>
          <strong>M4A</strong> is audio only too, usually using AAC. It sounds better than MP3 at the
          same size and is the native audio format on Apple devices.
        </li>
      </ul>

      <h2>Which one for what?</h2>
      <ul>
        <li>
          <strong>A lecture or tutorial with slides:</strong> MP4, because you need the picture.
        </li>
        <li>
          <strong>A podcast or talk for your commute:</strong> MP3, for small files that play
          anywhere.
        </li>
        <li>
          <strong>Music you&apos;re allowed to keep:</strong> M4A for the best quality, or MP3 for an
          older player.
        </li>
        <li>
          <strong>A clip you&apos;ll edit:</strong> MP4 at the Best quality, so you lose as little
          detail as possible.
        </li>
      </ul>

      <h2>Why VidNabbit&apos;s M4A says &quot;original&quot;</h2>
      <p>
        Online video and audio is usually stored with AAC sound already. VidNabbit&apos;s M4A option
        keeps that original audio stream as it is. MP3 has to be re-encoded from it, at 192 kbps,
        which sounds good to most ears but can&apos;t be better than the source.
      </p>

      <h2>Resolution and file size</h2>
      <p>
        For MP4, the number (480p, 720p, 1080p, 4K) is the picture height in pixels. Higher means
        sharper, and bigger files. Audio-only files are far smaller than any video. If storage or
        mobile data is tight, 720p or audio-only is usually the sweet spot.
      </p>

      <h2>Can I turn an MP3 back into a video?</h2>
      <p>
        No. Once you save audio only, the picture is gone. If you might want the video later, save
        the MP4 too. Every option is explained on <Link href="/formats">formats and quality</Link>.
      </p>

      <RelatedGuides current={guide.href} />
    </PageShell>
  );
}
