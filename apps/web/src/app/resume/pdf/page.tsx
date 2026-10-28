import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { ResumeTabs } from "@/components/convert/ConvertTabs";
import { ResumePdf } from "@/components/resume/ResumePdf";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free resume to PDF maker: ATS-friendly templates",
  description:
    "Turn your resume text into a clean, ATS-friendly PDF or Word file. Pick a template, colour, paper size and text size, preview it live and download. Free, no sign-up, nothing uploaded.",
  path: "/resume/pdf",
});

const FAQ = [
  {
    q: "Are these templates ATS-friendly?",
    a: "Yes. Every template is a single column with real, selectable text, standard headings and no tables, text boxes or images: the things that confuse applicant tracking systems.",
  },
  {
    q: "How do I get the layout right?",
    a: "Put your name on the first line and your contact details just below. Put each heading (Experience, Education, Skills…) on its own line, start bullets with •, and put dates at the end of each job title line, like \"Engineer, Acme · Jan 2022 – Present\". The preview updates as you type.",
  },
  {
    q: "PDF or Word?",
    a: "Both are here. Send the PDF when you want it to look exactly as designed; send Word when a job portal asks for .docx. Both use the same template.",
  },
  {
    q: "Is my resume uploaded?",
    a: "No. The PDF is made in your browser, on your device. Nothing is sent or saved, apart from your template choice, which your browser remembers for next time.",
  },
  {
    q: "Why do some characters show as “?”",
    a: "The PDF uses the standard fonts every PDF reader has, which cover English and Western European languages. For other scripts, download the Word version, which uses your computer's fonts.",
  },
];

export default function ResumePdfPage() {
  return (
    <ConvertPage
      tab="/resume/pdf"
      product="resunabbit"
      tabs={<ResumeTabs current="/resume/pdf" />}
      switchTo="convabbit"
      wide
      crumb="Resume to PDF"
      title={
        <>
          Resume to PDF. <span className="text-brand-gradient sm:block">Pick a look, download.</span>
        </>
      }
      intro="Turn your resume text into a clean, ATS-friendly PDF or Word file. Choose a template, colour and paper size, and see it live as you type."
      faq={FAQ}
    >
      <ResumePdf />
    </ConvertPage>
  );
}
