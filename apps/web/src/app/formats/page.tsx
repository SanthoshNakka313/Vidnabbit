import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs, RelatedGuides } from "@/app/_seo/content-parts";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Formats and quality: MP4, MP3, M4A and images",
  description:
    "Every download option VidNabbit offers: best-quality MP4 up to 4K, 1080p, 720p and 480p MP4, MP3 at 192 kbps, original M4A audio and original images.",
  path: "/formats",
});

const PRESETS = [
  {
    name: "Best (MP4)",
    what: "The highest-quality video and audio the source has, merged into one MP4. Up to 4K where available.",
    pick: "Archiving your own work, editing, big screens.",
  },
  {
    name: "MP4 1080p",
    what: "Full HD video with sound.",
    pick: "Laptops, TVs and most presentations.",
  },
  {
    name: "MP4 720p",
    what: "HD video with sound, at a much smaller size than 1080p.",
    pick: "Classrooms, phones and slow connections.",
  },
  {
    name: "MP4 480p",
    what: "Standard-definition video with sound. The smallest video option.",
    pick: "Saving phone storage or mobile data.",
  },
  {
    name: "MP3 (192 kbps)",
    what: "Audio only, in the format almost every device can play.",
    pick: "Podcasts, talks and music you're allowed to keep.",
  },
  {
    name: "M4A (original)",
    what: "Audio only, kept at the source's original quality without re-encoding.",
    pick: "The best audio quality, on Apple devices and modern players.",
  },
  {
    name: "Original image",
    what: "The image at the full resolution the source offers, usually JPG or PNG.",
    pick: "Photos and artwork you have the right to save.",
  },
];

export default function FormatsPage() {
  return (
    <PageShell>
      <Breadcrumbs trail={[{ name: "Formats and quality", path: "/formats" }]} />
      <h1>Formats and quality</h1>
      <p>
        After you paste a link, VidNabbit shows the formats the source really offers, with an
        estimated file size. You won&apos;t see options that don&apos;t exist: if a video was
        uploaded at 720p, there is no 1080p to pick.
      </p>

      <h2>Every option at a glance</h2>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">VidNabbit download formats</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 font-bold">
                Option
              </th>
              <th scope="col" className="py-2 pr-4 font-bold">
                What you get
              </th>
              <th scope="col" className="py-2 font-bold">
                Good for
              </th>
            </tr>
          </thead>
          <tbody>
            {PRESETS.map((p) => (
              <tr key={p.name} className="border-b border-border align-top">
                <th scope="row" className="py-2 pr-4 font-bold whitespace-nowrap">
                  {p.name}
                </th>
                <td className="py-2 pr-4">{p.what}</td>
                <td className="py-2">{p.pick}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Need something else? Choose <strong>Show all formats</strong> to see the full list the
        source provides.
      </p>

      <h2>Which one should I pick?</h2>
      <ul>
        <li>
          <strong>Not sure?</strong> MP4 720p plays everywhere and keeps files small.
        </li>
        <li>
          <strong>Keeping a master copy</strong> of your own upload? Pick Best.
        </li>
        <li>
          <strong>Only need the sound?</strong> MP3 for compatibility, M4A for quality.
        </li>
        <li>
          <strong>On mobile data?</strong> Check the estimated size first, then go for 480p or audio.
        </li>
      </ul>

      <h2>How big will the file be?</h2>
      <p>
        Size depends on length and quality. Each step up in resolution makes the file noticeably
        bigger, and audio-only files are far smaller than video. VidNabbit shows the size before you
        download when the source provides it; a size starting with ~ is an estimate. Files can be up to 4 GB, and media up to 3 hours long.
      </p>

      <h2>Images and multi-image posts</h2>
      <p>
        For image posts, VidNabbit lists each image at its original resolution, so you can save the
        ones you need.
      </p>

      <h2>What VidNabbit doesn&apos;t do</h2>
      <p>
        We don&apos;t upscale, edit or remove watermarks, and we never bypass DRM copy protection.
        See <Link href="/supported-sites">supported sites</Link> for what works.
      </p>

      <RelatedGuides current="/formats" />
    </PageShell>
  );
}
