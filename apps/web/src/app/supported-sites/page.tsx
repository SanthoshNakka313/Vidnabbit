import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Supported sites" };

const WORKS = [
  "Public videos on large video platforms (for example YouTube, Vimeo, Dailymotion), when the video plays without signing in",
  "Public posts with video or images on social sites, when the post is visible while signed out",
  "Public audio, such as podcasts and tracks shared openly (for example on SoundCloud or Bandcamp, when the creator allows streaming without an account)",
  "Creative Commons and public-domain media archives (for example Wikimedia Commons, Internet Archive)",
  "Ordinary web pages that link or embed a plain video, audio or image file",
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
        VidNabbit works with <strong>public</strong> pages: if a video, audio track or image plays
        or shows in a private browser window without signing in, we can usually read it. Site
        support changes often, so the examples below are a guide, not a guarantee. We are not
        affiliated with any of these sites.
      </p>

      <h2>Usually works</h2>
      <ul>
        {WORKS.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>

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
