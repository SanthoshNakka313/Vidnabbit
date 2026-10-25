interface ProgressBarProps {
  /** 0..1, or null for indeterminate. */
  value: number | null;
  label: string;
  labelId: string;
}

/**
 * Accessible progress bar. Width is set from client state only (never in
 * server HTML), so it doesn't need an inline-style CSP exception.
 */
export function ProgressBar({ value, label, labelId }: ProgressBarProps) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-labelledby={labelId}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct === null ? label : `${pct}%, ${label}`}
      className="h-3.5 w-full overflow-hidden rounded-full bg-surface-2 outline outline-1 -outline-offset-1 outline-strong/30"
    >
      {pct === null ? (
        <div className="vn-progress-indeterminate h-full w-full" />
      ) : (
        <div
          className="h-full rounded-full bg-brand-gradient transition-[width] duration-200 ease-vn"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
