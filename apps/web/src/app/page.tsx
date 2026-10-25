import { Downloader } from "@/components/downloader/Downloader";
import { HowItWorksSteps } from "@/components/HowItWorksSteps";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-3 sm:text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Download video, audio and images from a link
        </h1>
        <p className="text-lg text-muted">Free. No sign-up. Files are deleted after 1 hour.</p>
      </div>
      <Downloader />
      <HowItWorksSteps />
    </div>
  );
}
