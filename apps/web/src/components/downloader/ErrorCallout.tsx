"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApiError } from "@/lib/api";
import { friendlyError, type ErrorAction, type ErrorContext } from "@/lib/error-messages";
import { IconAlert, IconInfo } from "../icons";
import { buttonPrimary, linkInline } from "../ui/styles";

const TONE_CLASSES = {
  danger: "bg-danger-subtle border-danger text-danger",
  warning: "bg-warning-subtle border-warning text-warning",
  info: "bg-surface border-strong text-text",
} as const;

interface ErrorCalloutProps {
  error: ApiError;
  context?: ErrorContext;
  onAction: (action: ErrorAction) => void;
  /** Move focus to the title when shown (default true). */
  autoFocus?: boolean;
}

/** Counts down from `seconds` to 0, once per second. */
function useCountdown(seconds: number | null) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const started = Date.now();
    const t = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [seconds]);
  return left;
}

export function ErrorCallout({ error, context, onAction, autoFocus = true }: ErrorCalloutProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retryAfter =
    error.code === "rate_limited" ? (error.retryAfterSeconds ?? 60) : null;
  const left = useCountdown(retryAfter);
  const copy = friendlyError(error.code, { ...context, retryAfterSeconds: retryAfter });
  const waiting = retryAfter !== null && left > 0;

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus, error]);

  const Icon = copy.tone === "info" ? IconInfo : IconAlert;

  return (
    <div
      role="alert"
      data-error-code={error.code}
      className={`rounded-lg border p-4 sm:p-5 ${TONE_CLASSES[copy.tone]}`}
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 ref={titleRef} tabIndex={-1} className="text-lg font-semibold">
            {copy.title}
          </h2>
          <p className="mt-1 text-text">{copy.description}</p>
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className={buttonPrimary}
              disabled={waiting}
              onClick={() => onAction(copy.action)}
            >
              {waiting ? `${copy.actionLabel} in ${left}s` : copy.actionLabel}
            </button>
            {copy.link && (
              <Link href={copy.link.href} className={`${linkInline} inline-flex min-h-tap items-center`}>
                {copy.link.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
