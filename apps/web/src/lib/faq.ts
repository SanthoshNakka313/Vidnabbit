/**
 * FAQ copy. Plain-text answers so the same string can be shown on the page and
 * used in FAQPage JSON-LD (the two must match). Every claim here must stay true
 * to the product: update it when limits or presets change.
 */
export interface FaqItem {
  q: string;
  /** Plain text only (no HTML or Markdown). */
  a: string;
}

/** The home page FAQ (see apps/web/SEO.md, "Home page copy"). */
export const homeFaq: FaqItem[] = [
  {
    q: "Is VidNabbit free?",
    a:
      "Yes. VidNabbit is free to use, with no sign-up and no ads. A fair-use limit stops any one person from hogging the service.",
  },
  {
    q: "What can I download with VidNabbit?",
    a:
      "Media you own or have the right to download: your own uploads, Creative Commons or public-domain media, and direct links to video, audio or image files. The page has to be public, so if it plays in a private browser window without signing in, we can usually read it.",
  },
  {
    q: "Which formats can I pick?",
    a:
      "Video as MP4 (best available, up to 4K where the source has it, or 1080p, 720p and 480p), audio as MP3 at 192 kbps or M4A at the original quality, and images at their original resolution. We only show the options the source really offers.",
  },
  {
    q: "Do I need to install an app or an extension?",
    a:
      "No. VidNabbit runs in your web browser on a phone, tablet or computer. Paste a link, pick a format and the file downloads like any other.",
  },
  {
    q: "Do you keep my files?",
    a:
      "No. Files are prepared when you ask for them and deleted automatically after 1 hour. There is no public gallery, and nobody else can browse your downloads.",
  },
  {
    q: "Do you need my password or cookies?",
    a:
      "Never. VidNabbit never asks for, stores or uses your passwords, cookies or login sessions. That is also why content behind a sign-in is out of reach.",
  },
  {
    q: "Why was my link refused?",
    a:
      "We refuse DRM-protected services, private or members-only content, anything behind a sign-in or paywall, live streams, and items removed at a rights holder's request. Media over 3 hours long or files over 4 GB are refused too.",
  },
  {
    q: "Is it legal to download videos?",
    a:
      "It depends on the content and where you live. Saving your own uploads, public-domain media or media licensed for download is generally fine. Saving copyrighted content without permission usually isn't. Our guide explains the basics, but it is not legal advice.",
  },
];

/**
 * Extra questions for /faq. /faq shows homeFaq + moreFaqs, but its FAQPage
 * JSON-LD only marks up moreFaqs: Google asks for repeated FAQ content to be
 * marked up once per site, and the home page already marks up homeFaq.
 */
export const moreFaqs: FaqItem[] = [
  {
    q: "Does VidNabbit work on iPhone and Android?",
    a:
      "Yes. It works in modern mobile browsers such as Safari and Chrome. On an iPhone, Safari saves the file to the Files app (in Downloads); you can then move a video or photo to your Photos library from there.",
  },
  {
    q: "What is the best quality I can get?",
    a:
      "The Best option merges the highest-quality video and audio the source offers into one MP4, up to 4K where available. We can't add quality that isn't there: if the original was uploaded at 720p, 720p is the best you can get.",
  },
  {
    q: "Can I download only the audio?",
    a:
      "Yes. Pick MP3 (192 kbps) for the widest compatibility, or M4A to keep the original audio quality without re-encoding.",
  },
  {
    q: "Why do I see a quick bot check?",
    a:
      "We use Cloudflare Turnstile to keep automated abuse away, which keeps VidNabbit fast and free for people. Most of the time it finishes on its own in a second or two.",
  },
  {
    q: "How long does a download take?",
    a:
      "Usually seconds to a few minutes. It depends on the length and quality you pick and on how fast the source site responds. A progress bar shows how it's going.",
  },
  {
    q: "Are there size or length limits?",
    a:
      "Yes. Media can be up to 3 hours long and files up to 4 GB. There is also a fair-use limit on how many requests you can make in a short time.",
  },
  {
    q: "Does VidNabbit track me?",
    a:
      "There are no accounts, no ads and no third-party tracking scripts. We process the link you paste and a hashed or truncated IP address for rate limits. See the privacy page for details.",
  },
  {
    q: "I'm a rights holder. How do I get content blocked?",
    a:
      "Send a request through the copyright and takedown page. Approved links are blocked for everyone, and you can also ask us to exclude a whole site.",
  },
];

export const allFaqs: FaqItem[] = [...homeFaq, ...moreFaqs];
