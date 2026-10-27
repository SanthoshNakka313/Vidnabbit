"use client";

import { useEffect, useId, useRef, useState } from "react";
import { INPUT_LABEL } from "@/lib/convert/formats";
import { ConvertError, IMAGE_ACCEPT, outputName } from "@/lib/convert/image";
import { imagesToPdf, mergePdfs, pdfToImages, type PageSize } from "@/lib/convert/pdf";
import { WORD_ACCEPT, pdfToWord, printWord, wordToPdf } from "@/lib/convert/word";
import { formatBytes } from "@/lib/format";
import { IconArrowDown, IconArrowUp, IconFileText, IconImage, IconLayers, IconTrash } from "../icons";
import { buttonGhost, buttonPrimary, inputBase } from "../ui/styles";
import { FileDrop } from "./FileDrop";
import { ResultList, type ResultItem } from "./ResultList";

export type DocTool = "word-to-pdf" | "pdf-to-word" | "images-to-pdf" | "pdf-to-images" | "merge-pdf";

const TOOLS: { id: DocTool; label: string; Icon: typeof IconImage; blurb: string }[] = [
  { id: "word-to-pdf", label: "Word to PDF", Icon: IconFileText, blurb: "Turn .docx documents into PDFs." },
  { id: "pdf-to-word", label: "PDF to Word", Icon: IconFileText, blurb: "Get an editable .docx from a PDF." },
  { id: "images-to-pdf", label: "Images to PDF", Icon: IconImage, blurb: "Turn photos or scans into one PDF, in the order you choose." },
  { id: "pdf-to-images", label: "PDF to JPG / PNG", Icon: IconFileText, blurb: "Save every page of a PDF as an image." },
  { id: "merge-pdf", label: "Merge PDFs", Icon: IconLayers, blurb: "Join several PDFs into one, in the order you choose." },
];

const errorText = (e: unknown, fallback: string) => (e instanceof ConvertError ? e.message : fallback);

/** Ordered file list with move up/down and remove (keyboard-friendly instead of drag-to-reorder). */
function OrderList({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...files];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setFiles(next);
  };
  return (
    <ol className="flex flex-col gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 pl-4">
          <span className="tabular w-6 font-black text-muted">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate font-bold">{f.name}</span>
          <span className="hidden text-sm text-muted sm:inline">{formatBytes(f.size)}</span>
          <button type="button" className={buttonGhost} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${f.name} up`}>
            <IconArrowUp size={18} />
          </button>
          <button type="button" className={buttonGhost} disabled={i === files.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${f.name} down`}>
            <IconArrowDown size={18} />
          </button>
          <button type="button" className={buttonGhost} onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
            <IconTrash size={18} />
          </button>
        </li>
      ))}
    </ol>
  );
}

export function DocumentTools({ initialTool = "word-to-pdf" }: { initialTool?: DocTool }) {
  const [tool, setTool] = useState<DocTool>(initialTool);
  // Links like /convert/documents?tool=pdf-to-word open a tool directly. Read after
  // load (not via searchParams) so the page itself stays static.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tool");
    const match = TOOLS.find((t) => t.id === wanted);
    if (match) setTool(match.id);
  }, []);
  const [queue, setQueue] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [imageFormat, setImageFormat] = useState<"png" | "jpeg">("jpeg");
  const [pdfMode, setPdfMode] = useState<"download" | "print">("download");
  const [busy, setBusy] = useState<string | null>(null);
  const [items, setItems] = useState<ResultItem[]>([]);
  const seq = useRef(0);
  const ids = { page: useId(), fmt: useId(), mode: useId() };

  function switchTool(next: DocTool) {
    setTool(next);
    setQueue([]);
    setItems([]);
  }

  async function run(label: string, source: string, work: () => Promise<{ name: string; blob: Blob; detail?: string }[]>) {
    const key = `d${++seq.current}`;
    setBusy(label);
    setItems((prev) => [{ key, source, status: "working" }, ...prev]);
    try {
      const outputs = await work();
      setItems((prev) => [
        ...outputs.map((o, i) => ({ key: `${key}-${i}`, source, status: "done" as const, output: o, preview: o.blob.type.startsWith("image/") })),
        ...prev.filter((p) => p.key !== key),
      ]);
      setQueue([]);
    } catch (e) {
      setItems((prev) => prev.map((p) => (p.key === key ? { ...p, status: "error", error: errorText(e, "Something went wrong.") } : p)));
    } finally {
      setBusy(null);
    }
  }

  const pdfName = () => outputName(queue[0]?.name ?? "document", "pdf").replace(/\.pdf$/, tool === "merge-pdf" ? "-merged.pdf" : ".pdf");

  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className="sr-only">Choose a tool</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(({ id, label, Icon, blurb }) => (
            <label
              key={id}
              className="flex cursor-pointer flex-col gap-1 rounded-lg border-2 border-border bg-surface p-4 transition-colors hover:border-accent-strong/50 has-[:checked]:border-accent-strong has-[:checked]:bg-accent-subtle has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent-strong/20"
            >
              <input type="radio" name="doc-tool" value={id} checked={tool === id} onChange={() => switchTool(id)} className="sr-only" />
              <span className="inline-flex items-center gap-2 font-black">
                <Icon size={20} className="text-accent-strong" />
                {label}
              </span>
              <span className="text-sm text-muted">{blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {tool === "word-to-pdf" && (
        <div className="max-w-md">
          <label htmlFor={ids.mode} className="mb-1 block font-bold">PDF type</label>
          <select id={ids.mode} value={pdfMode} onChange={(e) => setPdfMode(e.target.value as "download" | "print")} className={`${inputBase} h-control`}>
            <option value="download">Exact look, download straight away</option>
            <option value="print">Selectable text, through the print dialog</option>
          </select>
          <p className="mt-1 text-sm text-muted">
            {pdfMode === "download"
              ? "Each page is saved as a sharp image, exactly as laid out. Text can't be selected."
              : "Your browser's print dialog opens: choose “Save as PDF” as the printer."}
          </p>
        </div>
      )}
      {tool === "pdf-to-word" && (
        <p className="text-sm text-muted">
          Text, headings, bold and italic come across as editable text. Scanned pages are added as pictures. Complex layouts
          (columns, text boxes, tables) may need tidying in Word.
        </p>
      )}
      {tool === "images-to-pdf" && (
        <div className="max-w-xs">
          <label htmlFor={ids.page} className="mb-1 block font-bold">Page size</label>
          <select id={ids.page} value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSize)} className={`${inputBase} h-control`}>
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="fit">Same as each image</option>
          </select>
        </div>
      )}
      {tool === "pdf-to-images" && (
        <div className="max-w-xs">
          <label htmlFor={ids.fmt} className="mb-1 block font-bold">Image format</label>
          <select id={ids.fmt} value={imageFormat} onChange={(e) => setImageFormat(e.target.value as "png" | "jpeg")} className={`${inputBase} h-control`}>
            <option value="jpeg">JPG (smaller files)</option>
            <option value="png">PNG (sharpest text)</option>
          </select>
        </div>
      )}

      <FileDrop
        key={tool}
        accept={tool === "images-to-pdf" ? IMAGE_ACCEPT : tool === "word-to-pdf" ? WORD_ACCEPT : "application/pdf,.pdf"}
        multiple={tool === "images-to-pdf" || tool === "merge-pdf" || (tool === "word-to-pdf" && pdfMode === "download")}
        hint={
          tool === "word-to-pdf"
            ? "Word .docx files up to 50 MB. Old .doc files need saving as .docx first."
            : tool === "pdf-to-word"
              ? "One PDF up to 100 MB and 300 pages."
              : tool === "images-to-pdf"
            ? `${INPUT_LABEL}. Up to 100 MB each.`
            : tool === "merge-pdf"
              ? "PDF files up to 100 MB each. Password-protected PDFs can't be merged."
              : "One PDF up to 100 MB and 300 pages."
        }
        buttonLabel={
          tool === "word-to-pdf"
            ? "Choose Word files"
            : tool === "images-to-pdf"
              ? "Choose images"
              : tool === "merge-pdf"
                ? "Choose PDFs"
                : "Choose a PDF"
        }
        onFiles={(files) => {
          if (tool === "word-to-pdf" && pdfMode === "print") {
            const f = files[0];
            setBusy("Preparing the document…");
            printWord(f)
              .catch((e) => setItems((prev) => [{ key: `p${++seq.current}`, source: f.name, status: "error", error: errorText(e, "Something went wrong.") }, ...prev]))
              .finally(() => setBusy(null));
          } else if (tool === "word-to-pdf") {
            void (async () => {
              for (const f of files) {
                await run("Converting…", f.name, async () => {
                  const blob = await wordToPdf(f, (done, total) => setBusy(`${f.name}: page ${done} of ${total}…`));
                  return [{ name: outputName(f.name, "pdf"), blob }];
                });
              }
            })();
          } else if (tool === "pdf-to-word") {
            const f = files[0];
            void run("Reading the PDF…", f.name, async () => {
              const blob = await pdfToWord(f, (done, total) => setBusy(`Reading page ${done} of ${total}…`));
              return [{ name: outputName(f.name, "docx"), blob }];
            });
          } else if (tool === "pdf-to-images") {
            const f = files[0];
            void run("Rendering pages…", f.name, async () => {
              const pages = await pdfToImages(f, imageFormat, (done, total) => setBusy(`Rendering page ${done} of ${total}…`));
              return pages.map((p) => ({ name: p.name, blob: p.blob, detail: `page ${p.page}` }));
            });
          } else {
            setQueue((q) => [...q, ...files]);
          }
        }}
      />

      {queue.length > 0 && (
        <div className="flex flex-col gap-3">
          <OrderList files={queue} setFiles={setQueue} />
          <button
            type="button"
            className={`${buttonPrimary} self-center`}
            disabled={!!busy || (tool === "merge-pdf" && queue.length < 2)}
            onClick={() =>
              void run(tool === "merge-pdf" ? "Merging…" : "Creating PDF…", `${queue.length} files`, async () => {
                const name = pdfName();
                const blob = tool === "merge-pdf" ? await mergePdfs(queue) : await imagesToPdf(queue, pageSize);
                return [{ name, blob, detail: `${queue.length} ${tool === "merge-pdf" ? "PDFs" : "pages"}` }];
              })
            }
          >
            {tool === "merge-pdf" ? <IconLayers /> : <IconFileText />}
            {tool === "merge-pdf"
              ? queue.length < 2 ? "Add at least 2 PDFs" : `Merge ${queue.length} PDFs`
              : `Create PDF (${queue.length} ${queue.length === 1 ? "page" : "pages"})`}
          </button>
        </div>
      )}

      {busy && (
        <p role="status" className="text-center font-bold text-muted">
          {busy}
        </p>
      )}
      <ResultList items={items} zipName={tool === "pdf-to-images" ? "vidnabbit-pdf-pages.zip" : "vidnabbit-pdfs.zip"} />
    </div>
  );
}
