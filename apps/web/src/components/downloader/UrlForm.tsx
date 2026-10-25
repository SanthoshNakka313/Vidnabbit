"use client";

import { useId, useState, useSyncExternalStore, type FormEvent, type Ref } from "react";
import { validateUrl } from "@/lib/url";
import { IconAlert, IconClipboard, IconSpinner, IconX } from "../icons";
import { buttonPrimary, buttonSecondary, inputBase, linkInline } from "../ui/styles";
import Link from "next/link";

interface UrlFormProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Called with a normalised, client-validated URL. */
  onSubmit: (url: string) => void;
  loading: boolean;
  inputRef: Ref<HTMLInputElement>;
  focusInput: () => void;
}

const noopSubscribe = () => () => {};

/** True after hydration if the async Clipboard API can read text. */
function useCanReadClipboard() {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== "undefined" && !!navigator.clipboard?.readText,
    () => false,
  );
}

export function UrlForm({
  value,
  onValueChange,
  onSubmit,
  loading,
  inputRef,
  focusInput,
}: UrlFormProps) {
  const inputId = useId();
  const errorId = useId();
  const helpId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const canRead = useCanReadClipboard();

  function submit(raw: string) {
    const result = validateUrl(raw);
    if (!result.ok) {
      setError(result.message);
      focusInput();
      return;
    }
    setError(null);
    onSubmit(result.url);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    submit(value);
  }

  async function handlePaste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setError("Your clipboard is empty. Copy a link first.");
        focusInput();
        return;
      }
      onValueChange(text);
      // Paste submits automatically when the link is valid (docs/04-design.md S1).
      submit(text);
    } catch {
      setPasteBlocked(true);
      setError(null);
      focusInput();
    }
  }

  function handleClear() {
    onValueChange("");
    setError(null);
    focusInput();
  }

  const describedBy = [error ? errorId : null, helpId].filter(Boolean).join(" ");

  return (
    <form
      role="search"
      aria-label="Get media from a link"
      onSubmit={handleSubmit}
      noValidate
      className="vn-gradient-ring rounded-xl p-3 shadow-lg sm:p-4"
    >
      <label htmlFor={inputId} className="mb-2 block px-1 text-left font-bold">
        Paste a link
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            id={inputId}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="https://your-video-link…"
            value={value}
            onChange={(e) => {
              onValueChange(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`${inputBase} h-control-lg text-lg ${value ? "pr-12" : ""}`}
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear link"
              className="absolute right-1.5 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
            >
              <IconX />
            </button>
          )}
        </div>
        <div className="flex gap-3">
          {canRead && !pasteBlocked && (
            <button
              type="button"
              onClick={handlePaste}
              disabled={loading}
              className={`${buttonSecondary} h-control-lg flex-1 sm:flex-none`}
            >
              <IconClipboard />
              Paste
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className={`${buttonPrimary} h-control-lg flex-1 whitespace-nowrap px-7 sm:flex-none`}
          >
            {loading ? (
              <>
                <IconSpinner />
                Nabbing…
              </>
            ) : (
              "Nab it"
            )}
          </button>
        </div>
      </div>
      {error && (
        <p id={errorId} className="mt-3 flex items-start gap-2 px-1 text-left text-sm font-bold text-danger">
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <p id={helpId} className="mt-3 px-1 text-left text-sm text-muted">
        {pasteBlocked && (
          <>Paste with Ctrl+V (or ⌘V on a Mac), then press Enter. </>
        )}
        Public links to media you own or may download.{" "}
        <Link href="/supported-sites" className={linkInline}>
          See supported sites
        </Link>
        .
      </p>
    </form>
  );
}
