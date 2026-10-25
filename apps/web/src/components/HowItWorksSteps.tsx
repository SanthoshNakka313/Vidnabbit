const STEPS = [
  { title: "Paste a link", body: "Copy the address of a public page with a video, audio track or image." },
  { title: "Pick a format", body: "Choose the quality you need: MP4 video, MP3 or M4A audio, or original images." },
  { title: "Save the file", body: "We prepare the file and give you a download link. It's deleted after 1 hour." },
];

export function HowItWorksSteps({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="how-it-works-heading">
      <Heading id="how-it-works-heading" className="mb-4 text-xl font-semibold">
        How it works
      </Heading>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <span
              aria-hidden="true"
              className="tabular inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle font-semibold text-accent-strong"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-medium">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </p>
              <p className="mt-1 text-sm text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
