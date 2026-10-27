import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { DocumentTools } from "@/components/convert/DocumentTools";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free PDF tools: images to PDF, PDF to JPG, merge PDF",
  description:
    "Turn images into a PDF, save PDF pages as JPG or PNG, and merge PDFs for free, right in your browser. No upload, no sign-up, no watermark.",
  path: "/convert/documents",
});

const FAQ = [
  {
    q: "Are my documents uploaded anywhere?",
    a: "No. Every tool here runs in your web browser on your own device, so your PDFs and images are never sent to VidNabbit or anyone else.",
  },
  {
    q: "Can I convert Word, Excel or PowerPoint files?",
    a: "Not yet. Those formats need a full office suite to convert accurately, which doesn't run in a browser. For now, open the file in Word, Google Docs or LibreOffice and use File > Save as PDF (or Download as PDF), then use these tools.",
  },
  {
    q: "Is there a watermark or page limit?",
    a: "No watermark and no sign-up. PDFs can be up to 100 MB, and PDF to image works on up to 300 pages at a time.",
  },
  {
    q: "Why can't I merge or convert my PDF?",
    a: "Password-protected PDFs can't be opened in the browser. Remove the password in your PDF reader first, then try again.",
  },
  {
    q: "What quality are the page images?",
    a: "Pages are saved at about 144 dpi: sharp on screens and fine for most printing. Choose PNG for the crispest text, or JPG for smaller files.",
  },
];

export default function DocumentConverterPage() {
  return (
    <ConvertPage
      tab="/convert/documents"
      crumb="Document converter"
      title={
        <>
          Free PDF tools. <span className="text-brand-gradient sm:block">Images, pages and merging.</span>
        </>
      }
      intro="Make a PDF from images, save PDF pages as pictures, or merge PDFs. It all happens in your browser, for free."
      faq={FAQ}
    >
      <DocumentTools />
    </ConvertPage>
  );
}
