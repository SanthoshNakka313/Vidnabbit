import Link from "next/link";
import {
  IconClock,
  IconFilm,
  IconImage,
  IconLock,
  IconMusic,
  IconShield,
  IconSparkle,
  IconZap,
} from "../icons";
import { badgeSun, pill } from "../ui/styles";

/** Trust pills under the hero input. Every claim here is true of the product. */
export function TrustRow() {
  const items = [
    { Icon: IconSparkle, label: "Free, no sign-up" },
    { Icon: IconClock, label: "Deleted after 1 hour" },
    { Icon: IconLock, label: "No logins needed" },
    { Icon: IconShield, label: "No DRM bypassing" },
  ];
  return (
    <ul className="flex flex-wrap justify-center gap-2" aria-label="What you get">
      {items.map(({ Icon, label }) => (
        <li key={label} className={`${pill} border border-border bg-surface/80 text-text shadow-sm`}>
          <Icon size={16} className="text-accent" />
          {label}
        </li>
      ))}
    </ul>
  );
}

const FEATURES = [
  {
    Icon: IconZap,
    title: "Quick as a hop",
    body: "Paste, pick, save. Formats and file sizes show up in seconds, before you download anything.",
  },
  {
    Icon: IconFilm,
    title: "Up to 4K, your pick",
    body: "MP4 in 4K, 1080p, 720p or 480p, MP3 or M4A audio, and images in their original quality.",
  },
  {
    Icon: IconLock,
    title: "Private by design",
    body: "No account, and we never use your logins or cookies for other sites. Your file is deleted from our servers after 1 hour.",
  },
  {
    Icon: IconShield,
    title: "Fair to creators",
    body: "Only sites that allow downloading. No DRM bypassing, ever, and rights holders can ask us to remove a link.",
  },
];

export function Features() {
  return (
    <section aria-labelledby="features-heading">
      <h2 id="features-heading" className="mb-2 text-2xl sm:text-3xl">
        A free downloader that plays fair
      </h2>
      <p className="mb-8 text-muted">Built for your own uploads, Creative Commons and royalty-free media.</p>
      <ul className="grid gap-5 sm:grid-cols-2">
        {FEATURES.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-4 rounded-lg border border-border bg-surface p-6 shadow-md">
            <span
              aria-hidden="true"
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-strong"
            >
              <Icon size={24} />
            </span>
            <span>
              <h3 className="text-lg">{title}</h3>
              <p className="mt-1 text-muted">{body}</p>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FORMAT_GROUPS = [
  { Icon: IconFilm, title: "Video", chips: [["MP4 4K", "4K"], ["MP4 1080p", "HD"], ["MP4 720p", "HD"], ["MP4 480p", null]] },
  { Icon: IconMusic, title: "Audio", chips: [["MP3 192 kbps", null], ["M4A", null]] },
  { Icon: IconImage, title: "Images", chips: [["Original quality", null], ["Gallery items", null]] },
] as const;

export function FormatsShowcase() {
  return (
    <section aria-labelledby="formats-heading" className="rounded-xl bg-ink p-7 text-white sm:p-10">
      <h2 id="formats-heading" className="mb-2 text-2xl sm:text-3xl">
        Formats: MP4 up to 4K, MP3, M4A and images
      </h2>
      <p className="mb-8 max-w-prose text-white/75">
        We show the real size before you start, and the best match for your link is picked for you.
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        {FORMAT_GROUPS.map(({ Icon, title, chips }) => (
          <div key={title}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-sun">
              <Icon size={18} />
              {title}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {chips.map(([label, badge]) => (
                <li key={label} className={`${pill} bg-white/10 text-white ring-1 ring-white/15`}>
                  {label}
                  {badge && <span className={badgeSun}>{badge}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Link
        href="/formats"
        className="mt-8 inline-flex min-h-tap items-center gap-2 rounded-full bg-white/10 px-5 font-bold text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
      >
        Compare formats <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-heading"
      className="relative overflow-hidden rounded-xl bg-brand-gradient px-6 py-12 text-center text-white shadow-lg sm:py-16"
    >
      <h2 id="cta-heading" className="text-3xl sm:text-4xl">
        Got a link? Nab it.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-lg text-white/90">Paste it. Nab it. Free, with nothing to install.</p>
      <Link
        href="#nab"
        className="mt-8 inline-flex min-h-control-lg items-center justify-center rounded-md bg-white px-8 text-lg font-black text-ink shadow-md transition-transform hover:-translate-y-px"
      >
        Nab a link now
      </Link>
    </section>
  );
}
