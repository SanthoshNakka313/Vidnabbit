"use client";

import { useId, useRef, useState } from "react";
import { IconLock, IconUpload } from "../icons";
import { buttonPrimary } from "../ui/styles";

interface FileDropProps {
  accept: string;
  multiple?: boolean;
  /** e.g. "PNG, JPG, WebP, GIF, AVIF, SVG, ICO, BMP" */
  hint: string;
  buttonLabel: string;
  onFiles: (files: File[]) => void;
}

/** Drag-and-drop zone with a real file input behind a button (keyboard and screen-reader friendly). */
export function FileDrop({ accept, multiple = true, hint, buttonLabel, onFiles }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  function take(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-10 ${
        over ? "border-accent-strong bg-accent-subtle" : "border-strong/50 bg-surface-2/60"
      }`}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-14 items-center justify-center rounded-md bg-brand-gradient text-white shadow-cta"
      >
        <IconUpload size={28} />
      </span>
      <div>
        <button type="button" className={buttonPrimary} onClick={() => input.current?.click()} aria-describedby={hintId}>
          {buttonLabel}
        </button>
        <p className="mt-3 text-muted">or drop {multiple ? "files" : "a file"} here</p>
      </div>
      <p id={hintId} className="text-sm text-muted">
        {hint}
      </p>
      <p className="inline-flex items-center gap-1.5 text-sm font-bold text-success">
        <IconLock size={16} /> Your files never leave your device
      </p>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = ""; // allow picking the same file again
        }}
      />
    </div>
  );
}
