"use client";

import { useId, useRef, useState } from "react";
import { INPUT_LABEL, INPUT_ONLY } from "@/lib/convert/formats";
import { ConvertError, IMAGE_ACCEPT, OUTPUT_FORMATS, convertImage, formatById, type ImageOutput } from "@/lib/convert/image";
import { buttonGhost, inputBase } from "../ui/styles";
import { FileDrop } from "./FileDrop";
import { ResultList, type ResultItem } from "./ResultList";

const SIZES: { value: string; label: string }[] = [
  { value: "", label: "Original size" },
  { value: "3840", label: "Up to 3840 px (4K)" },
  { value: "1920", label: "Up to 1920 px" },
  { value: "1280", label: "Up to 1280 px" },
  { value: "640", label: "Up to 640 px" },
  { value: "256", label: "Up to 256 px" },
];
const MAX_FILES = 50;

export function ImageConverter({ initialFormat = "jpeg" }: { initialFormat?: ImageOutput }) {
  const [format, setFormat] = useState<ImageOutput>(initialFormat);
  const [quality, setQuality] = useState(90);
  const [maxSide, setMaxSide] = useState("");
  const [items, setItems] = useState<ResultItem[]>([]);
  const seq = useRef(0);
  const ids = { format: useId(), quality: useId(), size: useId() };

  const fmt = formatById(format);

  async function add(files: File[]) {
    const batch = files.slice(0, MAX_FILES).map((file) => ({ file, key: `f${++seq.current}` }));
    setItems((prev) => [
      ...batch.map(({ file, key }) => ({ key, source: file.name, sourceBytes: file.size, status: "working" as const })),
      ...prev,
    ]);
    const opts = { format, quality: quality / 100, maxSide: maxSide ? Number(maxSide) : null };
    for (const { file, key } of batch) {
      let update: Partial<ResultItem>;
      try {
        const out = await convertImage(file, opts);
        update = {
          status: "done",
          preview: !["ico", "tiff", "eps", "jxl"].includes(format),
          output: {
            name: out.name,
            blob: out.blob,
            detail: `${out.width}×${out.height}${out.frames > 1 ? ` · ${out.frames} frames` : ""}`,
          },
        };
      } catch (e) {
        update = { status: "error", error: e instanceof ConvertError ? e.message : "This file couldn't be converted." };
      }
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...update } : i)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={ids.format} className="mb-1 block font-bold">
            Convert to
          </label>
          <select
            id={ids.format}
            value={format}
            onChange={(e) => setFormat(e.target.value as ImageOutput)}
            className={`${inputBase} h-control`}
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.quality} className="mb-1 block font-bold">
            Quality{fmt.lossy ? `: ${quality}%` : ""}
          </label>
          <input
            id={ids.quality}
            type="range"
            min={40}
            max={100}
            step={5}
            value={quality}
            disabled={!fmt.lossy}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="h-control w-full accent-accent disabled:opacity-40"
            aria-describedby={fmt.lossy ? undefined : `${ids.quality}-note`}
          />
          {!fmt.lossy && (
            <p id={`${ids.quality}-note`} className="text-sm text-muted">
              {fmt.label} is lossless.
            </p>
          )}
        </div>
        <div>
          <label htmlFor={ids.size} className="mb-1 block font-bold">
            Size
          </label>
          <select
            id={ids.size}
            value={maxSide}
            onChange={(e) => setMaxSide(e.target.value)}
            className={`${inputBase} h-control`}
          >
            {SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {fmt.note && <p className="-mt-2 text-sm text-muted">{fmt.note}</p>}

      <FileDrop
        accept={IMAGE_ACCEPT}
        hint={`Opens ${INPUT_LABEL}. Up to 50 files, 100 MB each.`}
        buttonLabel="Choose images"
        onFiles={add}
      />

      <ResultList items={items} zipName={`vidnabbit-${fmt.ext}-images.zip`} />
      <div className="text-sm text-muted">
        <p className="font-bold text-text">These open here but can&apos;t be saved:</p>
        <ul className="mt-1 list-disc pl-5">
          {INPUT_ONLY.map((f) => (
            <li key={f.label}>
              <strong>{f.label}</strong>: {f.why}
            </li>
          ))}
        </ul>
      </div>
      {items.length > 0 && (
        <button type="button" className={`${buttonGhost} self-center`} onClick={() => setItems([])}>
          Clear list
        </button>
      )}
    </div>
  );
}
