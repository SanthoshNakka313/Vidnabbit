import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { ResumeTabs } from "@/components/convert/ConvertTabs";
import { AtsChecker } from "@/components/resume/AtsChecker";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free resume ATS score checker: match your resume to a job",
  description:
    "Get a free ATS score for your resume in seconds. See missing keywords from the job ad, layout problems that confuse applicant tracking systems, and how to fix them. Nothing is uploaded.",
  path: "/resume/ats-checker",
});

const FAQ = [
  {
    q: "What is an ATS score?",
    a: "Most employers run applications through an applicant tracking system (ATS), which reads your resume and ranks it against the job. The score here estimates how well yours will do: whether the system can read it, whether it has the sections it looks for, how many of the job's keywords it contains, and how clearly it shows your impact.",
  },
  {
    q: "Is my resume uploaded?",
    a: "No. Your resume is read and scored in your own browser. It is never sent to VidNabbit or anyone else, and nothing is saved when you close the page.",
  },
  {
    q: "Is this the same score an employer sees?",
    a: "No tool can promise that: every ATS (Workday, Greenhouse, Lever, Taleo and others) works a little differently. This check covers what they have in common: readable text, standard headings, contact details in the body, simple layout and matching keywords.",
  },
  {
    q: "Why paste the job description?",
    a: "ATS rank candidates by how closely their resume matches the ad. With the ad, you'll see exactly which skills and terms you're missing. Only add the ones you genuinely have.",
  },
  {
    q: "PDF or Word: which should I send?",
    a: "Both work with modern systems if they're made from Word or Google Docs. Send .docx when the ad doesn't say, and never send a scan or a picture of your resume, because an ATS sees a blank page.",
  },
];

export default function AtsCheckerPage() {
  return (
    <ConvertPage
      tab="/resume/ats-checker"
      product="resunabbit"
      tabs={<ResumeTabs current="/resume/ats-checker" />}
      switchTo="convabbit"
      wide
      crumb="ATS resume checker"
      title={
        <>
          Free ATS resume checker. <span className="text-brand-gradient sm:block">Get past the robots.</span>
        </>
      }
      intro="Score your resume the way applicant tracking systems read it. See missing keywords, layout problems and quick fixes. Free, and your resume never leaves your device."
      faq={FAQ}
    >
      <AtsChecker />
    </ConvertPage>
  );
}
