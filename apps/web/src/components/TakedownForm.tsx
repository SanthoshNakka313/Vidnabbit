"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError, api, type TakedownRequest } from "@/lib/api";
import { friendlyError } from "@/lib/error-messages";
import { validateUrl } from "@/lib/url";
import { IconAlert, IconCheckCircle, IconSpinner } from "./icons";
import { buttonPrimary, inputBase } from "./ui/styles";

export const STATEMENT_GOOD_FAITH =
  "I have a good-faith belief that the use of the material described above is not authorised by the copyright owner, its agent, or the law.";
export const STATEMENT_ACCURACY =
  "The information in this request is accurate, and I am the owner of the rights concerned or authorised to act on the owner's behalf.";

type Field = "urls" | "name" | "email" | "organisation" | "goodFaith" | "accuracy" | "signature";
type Errors = Partial<Record<Field, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_URLS = 50;

export interface TakedownValues {
  urls: string;
  name: string;
  email: string;
  organisation: string;
  goodFaith: boolean;
  accuracy: boolean;
  signature: string;
}

/** Validates the form and builds the request body. Exported for tests. */
export function validateTakedown(v: TakedownValues): { errors: Errors; request?: TakedownRequest } {
  const errors: Errors = {};
  const lines = v.urls
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const urls: string[] = [];
  if (!lines.length) errors.urls = "Enter at least one link.";
  else if (lines.length > MAX_URLS) errors.urls = `Enter at most ${MAX_URLS} links per request.`;
  else {
    for (const line of lines) {
      const r = validateUrl(line);
      if (!r.ok) {
        errors.urls = `This link isn't valid: ${line.slice(0, 80)}`;
        break;
      }
      urls.push(r.url);
    }
  }
  const noNewlines = (s: string) => !/[\r\n]/.test(s);
  if (!v.name.trim()) errors.name = "Enter your name.";
  else if (!noNewlines(v.name) || v.name.length > 200) errors.name = "Enter a shorter name on one line.";
  if (!EMAIL_RE.test(v.email.trim()) || !noNewlines(v.email)) errors.email = "Enter a valid email.";
  if (!noNewlines(v.organisation) || v.organisation.length > 200) {
    errors.organisation = "Enter a shorter organisation name on one line.";
  }
  if (!v.goodFaith) errors.goodFaith = "Confirm the good-faith statement.";
  if (!v.accuracy) errors.accuracy = "Confirm the accuracy statement.";
  if (!v.signature.trim()) errors.signature = "Type your full name as your signature.";

  if (Object.keys(errors).length) return { errors };
  const request: TakedownRequest = {
    urls,
    name: v.name.trim(),
    email: v.email.trim(),
    statement_good_faith: true,
    statement_accuracy: true,
    signature: v.signature.trim(),
  };
  if (v.organisation.trim()) request.organisation = v.organisation.trim();
  return { errors, request };
}

const EMPTY: TakedownValues = {
  urls: "",
  name: "",
  email: "",
  organisation: "",
  goodFaith: false,
  accuracy: false,
  signature: "",
};

const FIELD_ORDER: Field[] = ["urls", "name", "email", "organisation", "goodFaith", "accuracy", "signature"];

export function TakedownForm() {
  const baseId = useId();
  const id = (f: Field) => `${baseId}-${f}`;
  const errId = (f: Field) => `${baseId}-${f}-error`;
  const [values, setValues] = useState<TakedownValues>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const submitErrorRef = useRef<HTMLParagraphElement>(null);

  function set<K extends keyof TakedownValues>(key: K, value: TakedownValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key as Field]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    const { errors: errs, request } = validateTakedown(values);
    setErrors(errs);
    if (!request) {
      const first = FIELD_ORDER.find((f) => errs[f]);
      if (first) formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id(first))}`)?.focus();
      return;
    }
    setStatus("submitting");
    try {
      await api.takedown(request);
      setStatus("success");
      setValues(EMPTY);
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (err) {
      setStatus("idle");
      setSubmitError(err instanceof ApiError ? err : new ApiError("internal", "Unexpected error"));
      requestAnimationFrame(() => submitErrorRef.current?.focus());
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-success bg-success-subtle p-5" role="status">
        <h3 ref={successRef} tabIndex={-1} className="mt-0! flex items-center gap-2 text-success">
          <IconCheckCircle />
          Request received
        </h3>
        <p className="mb-0! text-text">We&apos;ll review it and reply by email.</p>
      </div>
    );
  }

  const fieldError = (f: Field) =>
    errors[f] ? (
      <p id={errId(f)} className="mb-0! mt-1 flex items-start gap-1.5 text-sm text-danger">
        <IconAlert size={16} className="mt-0.5 shrink-0" />
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: Field) => ({
    id: id(f),
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": errors[f] ? errId(f) : undefined,
  });
  const label = "mb-1 block font-medium";

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <label htmlFor={id("urls")} className={label}>
          Links to remove (one per line)
        </label>
        <textarea
          {...a11y("urls")}
          rows={4}
          required
          value={values.urls}
          onChange={(e) => set("urls", e.target.value)}
          className={`${inputBase} py-3`}
        />
        {fieldError("urls")}
      </div>
      <div>
        <label htmlFor={id("name")} className={label}>
          Your name
        </label>
        <input
          {...a11y("name")}
          type="text"
          autoComplete="name"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          className={`${inputBase} h-control`}
        />
        {fieldError("name")}
      </div>
      <div>
        <label htmlFor={id("email")} className={label}>
          Email
        </label>
        <input
          {...a11y("email")}
          type="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          className={`${inputBase} h-control`}
        />
        {fieldError("email")}
      </div>
      <div>
        <label htmlFor={id("organisation")} className={label}>
          Organisation (optional)
        </label>
        <input
          {...a11y("organisation")}
          type="text"
          autoComplete="organization"
          value={values.organisation}
          onChange={(e) => set("organisation", e.target.value)}
          className={`${inputBase} h-control`}
        />
        {fieldError("organisation")}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">Statements (both required)</legend>
        {(
          [
            ["goodFaith", STATEMENT_GOOD_FAITH],
            ["accuracy", STATEMENT_ACCURACY],
          ] as const
        ).map(([f, text]) => (
          <div key={f}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                {...a11y(f)}
                type="checkbox"
                required
                checked={values[f]}
                onChange={(e) => set(f, e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-accent"
              />
              <span>{text}</span>
            </label>
            {fieldError(f)}
          </div>
        ))}
      </fieldset>
      <div>
        <label htmlFor={id("signature")} className={label}>
          Signature (type your full name)
        </label>
        <input
          {...a11y("signature")}
          type="text"
          required
          value={values.signature}
          onChange={(e) => set("signature", e.target.value)}
          className={`${inputBase} h-control`}
        />
        {fieldError("signature")}
      </div>
      {submitError && (
        <p
          ref={submitErrorRef}
          tabIndex={-1}
          role="alert"
          className="mb-0! rounded-md border border-danger bg-danger-subtle p-3 text-danger"
        >
          {submitError.code === "rate_limited" || submitError.code === "network_error"
            ? `${friendlyError(submitError.code).title}. ${friendlyError(submitError.code).description}`
            : "We couldn't send your request. Check the links and try again."}
        </p>
      )}
      <button
        type="submit"
        disabled={status === "submitting"}
        className={`${buttonPrimary} self-start`}
      >
        {status === "submitting" ? (
          <>
            <IconSpinner /> Sending…
          </>
        ) : (
          "Send request"
        )}
      </button>
    </form>
  );
}
