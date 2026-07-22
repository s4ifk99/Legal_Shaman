"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

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
          execution?: "render" | "execute";
        },
      ) => string;
      execute: (widgetId?: string) => void;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const CHALLENGE_TIMEOUT_MS = 30_000;

export type TurnstileHandle = {
  /** Run a fresh challenge and return a single-use token for the login/register request. */
  runChallenge: () => Promise<string>;
};

type TurnstileFieldProps = {
  resetKey?: number;
};

export const TurnstileField = forwardRef<TurnstileHandle, TurnstileFieldProps>(
  function TurnstileField({ resetKey = 0 }, ref) {
    const containerId = useId().replace(/:/g, "");
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const pendingRef = useRef<{
      resolve: (token: string) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    } | null>(null);
    const [scriptReady, setScriptReady] = useState(false);
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

    function clearPending(rejectReason?: Error) {
      const pending = pendingRef.current;
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      pendingRef.current = null;
      if (rejectReason) pending.reject(rejectReason);
    }

    useImperativeHandle(
      ref,
      () => ({
        runChallenge: () =>
          new Promise<string>((resolve, reject) => {
            if (!siteKey) {
              reject(new Error("CAPTCHA is not configured"));
              return;
            }
            if (!window.turnstile || !widgetIdRef.current) {
              reject(new Error("CAPTCHA is not ready yet"));
              return;
            }

            clearPending(new Error("CAPTCHA was restarted"));

            const timeoutId = setTimeout(() => {
              clearPending(new Error("CAPTCHA timed out"));
            }, CHALLENGE_TIMEOUT_MS);

            pendingRef.current = { resolve, reject, timeoutId };

            try {
              window.turnstile.reset(widgetIdRef.current);
              window.turnstile.execute(widgetIdRef.current);
            } catch {
              clearPending(new Error("CAPTCHA could not start"));
            }
          }),
      }),
      [siteKey],
    );

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

    useEffect(() => {
      clearPending(new Error("CAPTCHA was reset"));
    }, [resetKey]);

    useEffect(() => {
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
        execution: "execute",
        callback: (token) => {
          const pending = pendingRef.current;
          if (!pending) return;
          clearTimeout(pending.timeoutId);
          pendingRef.current = null;
          pending.resolve(token);
        },
        "expired-callback": () => clearPending(new Error("CAPTCHA expired")),
        "error-callback": () => clearPending(new Error("CAPTCHA failed")),
      });

      return () => {
        clearPending(new Error("CAPTCHA was reset"));
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* ignore */
          }
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, scriptReady, resetKey]);

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
  },
);
