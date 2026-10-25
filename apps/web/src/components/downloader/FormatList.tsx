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
  qualityBadge,
  recommendedFormatIds,
} from "@/lib/format";
import { IconCheck } from "../icons";
import { badgeSun } from "../ui/styles";

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
  const quality = qualityBadge(format);
  const rowDisabled = disabled || tooLarge;
  return (
    <li>
      <label
        className={`flex min-h-14 items-center gap-3 rounded-md border-2 px-4 py-2.5 transition-[border-color,background-color,box-shadow] duration-150 ${
          checked
            ? "border-accent-strong bg-accent-subtle shadow-sm"
            : "border-border bg-surface hover:border-accent-strong/40"
        } ${rowDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
      >
        <input
          type="radio"
          name={name}
          value={format.format_id}
          checked={checked}
          disabled={rowDisabled}
          onChange={() => onSelect(format.format_id)}
          className="size-5 shrink-0 accent-violet focus-visible:outline-none"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`font-bold ${checked ? "text-accent-strong" : ""}`}>{format.label}</span>
          {quality && <span className={badgeSun}>{quality}</span>}
          {details.map((d) => (
            <span key={d} className="tabular text-sm text-muted">
              {d}
            </span>
          ))}
          {recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet px-2.5 py-0.5 text-xs font-bold text-white">
              <IconCheck size={12} strokeWidth={2.5} />
              Recommended
            </span>
          )}
          {format.kind === "video" && !format.has_audio && (
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted">
              No audio
            </span>
          )}
        </span>
        <span className="tabular shrink-0 text-sm font-bold text-muted">
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
      <p className="rounded-lg bg-surface-2 p-5 text-muted">
        We found the page but no downloadable media. Try the direct link to the video or post.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5" id={listId}>
      {groups.map((group) => (
        <fieldset key={group.kind} disabled={disabled} className="min-w-0">
          <legend className="mb-3 text-sm font-black uppercase tracking-widest text-muted">
            {KIND_LABELS[group.kind]}
          </legend>
          <ul className="grid gap-2.5 sm:grid-cols-2">
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
          className="inline-flex min-h-tap items-center self-start rounded-full px-3 font-bold text-link underline-offset-4 hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${formats.length} formats`}
        </button>
      )}
    </div>
  );
}
