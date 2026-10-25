"use client";

import { useId, useMemo, useState } from "react";
import type { MediaFormat } from "@/lib/api";
import {
  KIND_LABELS,
  formatDetails,
  formatSize,
  groupFormats,
  isPrimaryFormat,
  isTooLarge,
  recommendedFormatIds,
} from "@/lib/format";
import { IconCheck } from "../icons";

interface FormatListProps {
  formats: MediaFormat[];
  selectedId: string | null;
  onSelect: (formatId: string) => void;
  disabled: boolean;
}

function FormatRow({
  format,
  name,
  checked,
  recommended,
  disabled,
  onSelect,
}: {
  format: MediaFormat;
  name: string;
  checked: boolean;
  recommended: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const tooLarge = isTooLarge(format);
  const details = formatDetails(format);
  const rowDisabled = disabled || tooLarge;
  return (
    <li>
      <label
        className={`flex min-h-[3.25rem] items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-150 ${
          checked
            ? "border-accent bg-accent-subtle text-accent-strong"
            : "border-border hover:bg-surface-2"
        } ${rowDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
      >
        <input
          type="radio"
          name={name}
          value={format.format_id}
          checked={checked}
          disabled={rowDisabled}
          onChange={() => onSelect(format.format_id)}
          className="size-5 shrink-0 accent-accent focus-visible:outline-none"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{format.label}</span>
          {details.map((d) => (
            <span key={d} className="tabular text-sm text-muted">
              {d}
            </span>
          ))}
          {recommended && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-accent-subtle px-2 py-0.5 text-xs font-semibold text-accent-strong ring-1 ring-accent/40">
              <IconCheck size={12} strokeWidth={2.5} />
              Recommended
            </span>
          )}
          {format.kind === "video" && !format.has_audio && (
            <span className="rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              No audio
            </span>
          )}
        </span>
        <span className="tabular shrink-0 text-sm text-muted">
          {tooLarge ? "Over 4 GB" : formatSize(format)}
        </span>
      </label>
    </li>
  );
}

/** Native radio groups, one fieldset per kind (Video / Audio / Images). */
export function FormatList({ formats, selectedId, onSelect, disabled }: FormatListProps) {
  const name = useId();
  const listId = useId();
  const [showAll, setShowAll] = useState(false);
  const recommended = useMemo(() => recommendedFormatIds(formats), [formats]);
  const hiddenCount = formats.filter((f) => !isPrimaryFormat(f)).length;
  const visible = showAll
    ? formats
    : formats.filter((f) => isPrimaryFormat(f) || f.format_id === selectedId);
  const groups = groupFormats(visible);

  if (!formats.length) {
    return (
      <p className="rounded-md bg-surface-2 p-4 text-muted">
        We found the page but no downloadable media. Try the direct link to the video or post.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5" id={listId}>
      {groups.map((group) => (
        <fieldset key={group.kind} disabled={disabled} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            {KIND_LABELS[group.kind]}
          </legend>
          <ul className="flex flex-col gap-2">
            {group.formats.map((f) => (
              <FormatRow
                key={f.format_id}
                format={f}
                name={name}
                checked={f.format_id === selectedId}
                recommended={recommended.has(f.format_id)}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </fieldset>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((s) => !s)}
          className="inline-flex min-h-tap items-center self-start rounded-md px-2 font-medium text-accent underline-offset-2 hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${formats.length} formats`}
        </button>
      )}
    </div>
  );
}
