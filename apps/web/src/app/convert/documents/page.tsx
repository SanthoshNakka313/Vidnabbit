import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { DocumentTools } from "@/components/convert/DocumentTools";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Free Word to PDF and PDF to Word converter, plus PDF tools",
  description:
    "Convert Word to PDF and PDF to Word, turn images into a PDF, save PDF pages as JPG or PNG, and merge PDFs for free, right in your browser. No upload, no sign-up, no watermark.",
  path: "/convert/documents",
});

const FAQ = [
  {
    q: "Are my documents uploaded anywhere?",
    a: "No. Every tool here runs in your web browser on your own device, so your PDFs and images are never sent to VidNabbit or anyone else.",
  },
  {
    q: "How good is Word to PDF?",
    a: "Text, fonts, headings, lists, tables, images, headers and footers are laid out as in Word. Choose “Exact look” to download a PDF straight away (each page is a sharp image, so text can't be selected), or “Selectable text” to save through your browser's print dialog. Very complex layouts, such as floating text boxes, may differ slightly from Word.",
  },
  {
    q: "How good is PDF to Word?",
    a: "You get an editable .docx with the text, headings, bold and italic, page by page. Scanned pages have no text to read, so they are added as pictures. Columns, tables and text boxes come across as plain paragraphs and may need tidying in Word.",
  },
  {
    q: "Can I convert old .doc, Excel or PowerPoint files?",
    a: "Not yet. Open old .doc files in Word, Google Docs or LibreOffice and save them as .docx first. For Excel and PowerPoint, use File > Save as PDF in the app, then use these tools.",
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
          Free PDF tools. <span className="text-brand-gradient sm:block">Word, images and merging.</span>
        </>
      }
      intro="Word to PDF, PDF to Word, images to PDF, PDF to pictures, and merging. It all happens in your browser, for free."
      faq={FAQ}
    >
      <DocumentTools />
    </ConvertPage>
  );
}
