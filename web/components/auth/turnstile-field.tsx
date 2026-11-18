"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { resolveTurnstileSiteKey } from "@/lib/auth/turnstile-public";

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
      getResponse: (widgetId?: string) => string | undefined;
    };
  }
}

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";

export type TurnstileHandle = {
  getToken: () => string | null;
  resetWidget: () => void;
  isReady: () => boolean;
};

type TurnstileFieldProps = {
  resetKey?: number;
};

export const TurnstileField = forwardRef<TurnstileHandle, TurnstileFieldProps>(
  function TurnstileField({ resetKey = 0 }, ref) {
    const containerId = useId().replace(/:/g, "");
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    const [scriptReady, setScriptReady] = useState(false);
    const [siteKey, setSiteKey] = useState("");
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
      setSiteKey(resolveTurnstileSiteKey());
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getToken: () => {
          if (tokenRef.current) return tokenRef.current;
          if (!window.turnstile || !widgetIdRef.current) return null;
          const live = window.turnstile.getResponse(widgetIdRef.current);
          return live?.trim() ? live : null;
        },
        resetWidget: () => {
          tokenRef.current = null;
          if (window.turnstile && widgetIdRef.current) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              /* ignore */
            }
          }
        },
        isReady: () => Boolean(window.turnstile && widgetIdRef.current),
      }),
      [],
    );

    useEffect(() => {
      tokenRef.current = null;
    }, [resetKey]);

    useEffect(() => {
      if (!siteKey) return;
      setLoadError(null);

      if (window.turnstile) {
        setScriptReady(true);
        return;
      }

      if (document.getElementById(TURNSTILE_SCRIPT_ID)) {
        const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement;
        const onLoad = () => setScriptReady(true);
        const onError = () =>
          setLoadError("Could not load Cloudflare CAPTCHA. Check your network and retry.");
        existing.addEventListener("load", onLoad);
        existing.addEventListener("error", onError);
        return () => {
          existing.removeEventListener("load", onLoad);
          existing.removeEventListener("error", onError);
        };
      }

      const script = document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => setScriptReady(true);
      script.onerror = () =>
        setLoadError("Could not load Cloudflare CAPTCHA. Check your network and retry.");
      document.head.appendChild(script);
    }, [siteKey]);

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

      tokenRef.current = null;
      setLoadError(null);
      containerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => {
          tokenRef.current = token;
        },
        "expired-callback": () => {
          tokenRef.current = null;
        },
        "error-callback": () => {
          tokenRef.current = null;
          setLoadError("Cloudflare CAPTCHA could not connect. Retry or check blockers.");
        },
      });

      return () => {
        tokenRef.current = null;
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
      return (
        <p className="text-xs text-muted-foreground">Loading CAPTCHA…</p>
      );
    }

    return (
      <div className="space-y-2">
        <div id={containerId} ref={containerRef} className="min-h-[65px]" />
        {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      </div>
    );
  },
);
