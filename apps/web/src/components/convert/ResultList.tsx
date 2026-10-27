"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "@/lib/format";
import { saveBlob, zipFiles } from "@/lib/convert/zip";
import { IconAlert, IconCheckCircle, IconDownload } from "../icons";
import { buttonPrimary, buttonSecondary } from "../ui/styles";

export interface ResultItem {
  key: string;
  /** Name of the file the user added. */
  source: string;
  sourceBytes?: number;
  status: "working" | "done" | "error";
  output?: { name: string; blob: Blob; detail?: string };
  error?: string;
  /** Show a thumbnail of the output (images only). */
  preview?: boolean;
}

function Thumb({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-14 shrink-0 rounded-md border border-border bg-surface-2 object-contain" />;
}

/** Converted files with a download button each, plus "Download all" as a ZIP. */
export function ResultList({ items, zipName }: { items: ResultItem[]; zipName: string }) {
  const [zipping, setZipping] = useState(false);
  const done = items.filter((i) => i.status === "done" && i.output);
  const working = items.some((i) => i.status === "working");
  if (!items.length) return null;

  return (
    <section aria-label="Converted files" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-live="polite">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            {item.output && item.preview ? <Thumb blob={item.output.blob} /> : null}
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{item.output?.name ?? item.source}</p>
              <p className="text-sm text-muted">
                {item.status === "working" && "Converting…"}
                {item.status === "error" && (
                  <span className="inline-flex items-start gap-1 text-danger">
                    <IconAlert size={16} className="mt-0.5 shrink-0" /> {item.error}
                  </span>
                )}
                {item.status === "done" && item.output && (
                  <span className="inline-flex items-center gap-1">
                    <IconCheckCircle size={16} className="text-success" />
                    {item.sourceBytes ? `${formatBytes(item.sourceBytes)} → ` : ""}
                    {formatBytes(item.output.blob.size)}
                    {item.output.detail ? ` · ${item.output.detail}` : ""}
                  </span>
                )}
              </p>
            </div>
            {item.status === "done" && item.output && (
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => saveBlob(item.output!.blob, item.output!.name)}
                aria-label={`Download ${item.output.name}`}
              >
                <IconDownload size={18} />
                <span className="hidden sm:inline">Download</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {done.length > 1 && !working && (
        <button
          type="button"
          className={`${buttonPrimary} self-center`}
          disabled={zipping}
          onClick={async () => {
            setZipping(true);
            try {
              saveBlob(await zipFiles(done.map((d) => d.output!)), zipName);
            } finally {
              setZipping(false);
            }
          }}
        >
          <IconDownload />
          {zipping ? "Zipping…" : `Download all (${done.length}) as ZIP`}
        </button>
      )}
    </section>
  );
}
