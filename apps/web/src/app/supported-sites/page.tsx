import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = pageMetadata({
  title: "Supported sites",
  description:
    "VidNabbit works with sites that allow downloading: the Internet Archive, Wikimedia Commons, Jamendo and direct file links. What never works: DRM, logins, private and live content.",
  path: "/supported-sites",
});

const WORKS = [
  { site: "Internet Archive (archive.org)", what: "public-domain and Creative Commons films, recordings and audio" },
  { site: "Wikimedia Commons", what: "freely licensed video, audio and images" },
  { site: "Jamendo", what: "Creative Commons music, tracks and albums" },
  {
    site: "Direct file links",
    what: "a link that ends in a media file such as .mp4, .mp3 or .jpg, for example your own files on your own site",
  },
];

const NEVER = [
  "DRM-protected streaming services, for example Netflix, Prime Video, Disney+, Hotstar premium, Spotify and Apple Music",
  "Anything that needs you to sign in, subscribe, pay or verify your age",
  "Private, members-only, or unlisted content that requires permission",
  "Live streams and premieres that haven't finished",
  "Content removed at a rights holder's request",
  "Media longer than 3 hours or files larger than 4 GB",
];

export default function SupportedSitesPage() {
  return (
    <PageShell>
      <h1>Supported sites</h1>
      <p>
        VidNabbit only works with sites that <strong>allow downloading</strong>. Many big video and
        social platforms don&apos;t allow it in their terms, so we don&apos;t support them, even
        for public posts. To save your own uploads from those sites, use their own download or
        account-export tools (see{" "}
        <Link href="/guides/save-your-own-uploads">how to save your own uploads</Link>). We are not
        affiliated with any of these sites.
      </p>

      <h2>Works with</h2>
      <ul>
        {WORKS.map((w) => (
          <li key={w.site}>
            <strong>{w.site}</strong>: {w.what}
          </li>
        ))}
      </ul>
      <p>
        We add sites once we&apos;ve checked that their terms allow downloading. Links from any
        other site are refused.
      </p>

      <h2>Never works</h2>
      <p>These limits are deliberate and we won&apos;t add workarounds:</p>
      <ul>
        {NEVER.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <h2>Why no DRM or logins?</h2>
      <p>
        DRM (digital rights management) is copy protection that rights holders add on purpose.
        VidNabbit never bypasses it. We also never ask for, store or use your passwords, cookies or
        login sessions, so content behind a sign-in is out of reach by design.
      </p>

      <h2>Only download what you&apos;re allowed to</h2>
      <p>
        Only download content you own, content licensed for download (such as Creative Commons), or
        content you have the owner&apos;s permission to use. See our <Link href="/terms">Terms</Link>.
      </p>

      <h2>Site owners</h2>
      <p>
        If you run a site and want it excluded from VidNabbit, or you are a rights holder who wants
        content removed, use the <Link href="/copyright">copyright and takedown page</Link>.
      </p>
    </PageShell>
  );
}
