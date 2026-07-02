"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";

type TurnstileFieldProps = {
  onTokenChange: (token: string | null) => void;
  resetKey?: number;
};

export function TurnstileField({ onTokenChange, resetKey = 0 }: TurnstileFieldProps) {
  const containerId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

  useEffect(() => {
    onTokenChange(null);
  }, [resetKey, onTokenChange]);

  useEffect(() => {
    if (!siteKey) return;

    if (window.turnstile) {
      setScriptReady(true);
      return;
    }

    if (document.getElementById(TURNSTILE_SCRIPT_ID)) {
      const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement;
      existing.addEventListener("load", () => setScriptReady(true));
      return;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptReady(true);
    document.head.appendChild(script);
  }, [siteKey]);

  const renderWidget = useCallback(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile) return;

    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        /* ignore */
      }
      widgetIdRef.current = null;
    }

    containerRef.current.innerHTML = "";
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: (token) => onTokenChange(token),
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => onTokenChange(null),
    });
  }, [siteKey, scriptReady, onTokenChange]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
    };
  }, [renderWidget, resetKey]);

  if (!siteKey) {
    if (process.env.NODE_ENV === "production") {
      return (
        <p className="text-sm text-destructive">CAPTCHA is not configured. Contact support.</p>
      );
    }
    return (
      <p className="text-xs text-muted-foreground">
        CAPTCHA skipped in development (set NEXT_PUBLIC_TURNSTILE_SITE_KEY).
      </p>
    );
  }

  return <div id={containerId} ref={containerRef} className="min-h-[65px]" />;
}
