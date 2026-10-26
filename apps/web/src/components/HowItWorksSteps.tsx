import { IconClipboard, IconDownload, IconFilm } from "./icons";

const STEPS = [
  {
    title: "Paste a link",
    body: "Copy a link from a site that allows downloading, or a direct link to a file.",
    Icon: IconClipboard,
  },
  {
    title: "Pick a format",
    body: "MP4 up to 4K, MP3 or M4A audio, or the original images. Sizes shown up front.",
    Icon: IconFilm,
  },
  {
    title: "Nab it",
    body: "We prepare the file and hand you a download link. It's deleted after 1 hour.",
    Icon: IconDownload,
  },
];

export function HowItWorksSteps({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="how-it-works-heading">
      <Heading id="how-it-works-heading" className="mb-2 text-2xl sm:text-3xl">
        How it works
      </Heading>
      <p className="mb-8 text-muted">Three hops and done. No app, no account, no waiting around.</p>
      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-md"
          >
            <span className="flex items-center justify-between">
              <span
                aria-hidden="true"
                className="inline-flex size-12 items-center justify-center rounded-md bg-brand-gradient text-white shadow-cta"
              >
                <step.Icon size={24} />
              </span>
              <span aria-hidden="true" className="tabular text-4xl font-black text-border">
                0{i + 1}
              </span>
            </span>
            <p className="text-lg font-black">
              <span className="sr-only">Step {i + 1}: </span>
              {step.title}
            </p>
            <p className="text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
