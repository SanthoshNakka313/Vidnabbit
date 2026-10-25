"use client";

import { useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/config";

/** Subset of the Cloudflare Turnstile client API that we use. */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      appearance?: "always" | "execute" | "interaction-only";
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Loads the Turnstile script once. It is injected by our own (nonce-trusted)
 * bundle, so CSP 'strict-dynamic' allows it.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile did not initialise"));
    };
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

interface TurnstileProps {
  onToken: (token: string) => void;
  /** Called when the widget can't load or the challenge errors. */
  onError: () => void;
}

/**
 * Renders the Turnstile widget. Mount it only when a download starts, so the
 * challenge never loads for people who are just browsing.
 */
export function Turnstile({ onToken, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Keep the latest callbacks without re-rendering the widget.
  const callbacks = useRef({ onToken, onError });
  useEffect(() => {
    callbacks.current = { onToken, onError };
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !containerRef.current) return;
        widgetId = ts.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "auto",
          size: "flexible",
          callback: (token) => callbacks.current.onToken(token),
          "error-callback": () => callbacks.current.onError(),
          "expired-callback": () => callbacks.current.onError(),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Widget already gone.
        }
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-2" data-testid="turnstile">
      <p className="text-sm text-muted">Quick check to keep VidNabbit free and bot-free.</p>
      <div ref={containerRef} className="min-h-[65px]" />
      {loadFailed && (
        <p role="alert" className="text-sm text-danger">
          The check didn&apos;t load. Disable content blockers for this site or try again.
        </p>
      )}
    </div>
  );
}
