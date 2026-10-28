import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { ResumeTabs } from "@/components/convert/ConvertTabs";
import { Humanizer } from "@/components/resume/Humanizer";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free resume humanizer: remove buzzwords and AI-sounding phrases",
  description:
    "Rewrite buzzwords, stock phrases and AI-sounding words in your resume into plain, specific language. See every change, copy the result or download it as Word. Free and private.",
  path: "/resume/humanizer",
});

const FAQ = [
  {
    q: "What does the resume humanizer change?",
    a: "It swaps stock phrases for plain ones (\"spearheaded\" becomes \"led\", \"utilized\" becomes \"used\", \"in order to\" becomes \"to\"), drops filler like \"successfully\", and replaces dashes that make text read like AI. Every change is highlighted so you can check it.",
  },
  {
    q: "Does it make things up?",
    a: "Never. It only rewrites wording. Things only you know, like a missing number or a vague \"responsible for\", are listed as tips instead of being changed.",
  },
  {
    q: "Is it an AI detector bypass?",
    a: "No. It doesn't try to trick any detector. It makes your resume clearer and more specific, which is what recruiters actually reward. The facts should always be yours.",
  },
  {
    q: "Is my resume uploaded?",
    a: "No. The rewrite runs in your browser, on your device. Nothing is sent or saved.",
  },
];

export default function HumanizerPage() {
  return (
    <ConvertPage
      tab="/resume/humanizer"
      product="resunabbit"
      tabs={<ResumeTabs current="/resume/humanizer" />}
      switchTo="convabbit"
      wide
      crumb="Resume humanizer"
      title={
        <>
          Resume humanizer. <span className="text-brand-gradient sm:block">Sound like you, not a template.</span>
        </>
      }
      intro="Turn buzzwords and AI-sounding phrases into plain, specific language. See every change, then copy it or download it as Word."
      faq={FAQ}
    >
      <Humanizer />
    </ConvertPage>
  );
}
