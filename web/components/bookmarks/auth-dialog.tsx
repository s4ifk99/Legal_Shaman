"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicUser } from "@/lib/auth/user-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TurnstileField, type TurnstileHandle } from "@/components/auth/turnstile-field";
import { B2C_PAID_PRICE_LABEL } from "@/lib/billing/plan";
import { resolveApiUrl } from "@/lib/site/api-url";

export type AuthDialogReason = "bookmark" | "search" | "login" | "coherence";

type AuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (user: PublicUser) => void;
  reason?: AuthDialogReason;
  pendingFirmName?: string;
};

const AUTH_FETCH_TIMEOUT_MS = 20_000;

function defaultTabForReason(reason: AuthDialogReason): "register" | "login" {
  return reason === "login" ? "login" : "register";
}

function copyForReason(reason: AuthDialogReason, pendingFirmName?: string) {
  if (reason === "coherence") {
    return {
      title: "Create a free account to analyse your matter",
      description:
        "Your first search is free. After that, unlock unlimited Ask the Shaman for " +
        B2C_PAID_PRICE_LABEL +
        " on this account.",
    };
  }
  if (reason === "search") {
    return {
      title: "Create a free account to view results",
      description:
        "Sign up for three free searches. Then unlock unlimited searches for " +
        B2C_PAID_PRICE_LABEL +
        ", tied to your account.",
    };
  }
  if (reason === "login") {
    return {
      title: "Sign in to Legal Shaman",
      description:
        "Use your email and password to access bookmarks, search results, and your saved shortlist.",
    };
  }
  return {
    title: "Save to your bookmarks",
    description: pendingFirmName
      ? `Create a free account to bookmark ${pendingFirmName} and view your shortlist anytime.`
      : "Create a free account with your email to view your saved firms.",
  };
}

async function postAuth(
  path: "/api/auth/login" | "/api/auth/register" | "/api/auth/forgot-password",
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  data: { user?: PublicUser; error?: string; message?: string };
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
  try {
    const url = resolveApiUrl(path);
    const crossOrigin =
      typeof window !== "undefined" &&
      url.startsWith("http") &&
      !url.startsWith(window.location.origin);

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: crossOrigin ? "include" : "same-origin",
    });
    const text = await res.text();
    let data: { user?: PublicUser; error?: string; message?: string } = {};
    if (text) {
      try {
        data = JSON.parse(text) as { user?: PublicUser; error?: string; message?: string };
      } catch {
        return {
          ok: false,
          status: res.status,
          data: {
            error:
              res.status >= 500
                ? "Server error. Try again on www.legalshaman.com."
                : "Unexpected server response. Try again.",
          },
        };
      }
    }
    const error = data.error ?? data.message;
    return { ok: res.ok, status: res.status, data: { user: data.user, error, message: data.message } };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, status: 0, data: { error: "Request timed out. Try again." } };
    }
    return { ok: false, status: 0, data: { error: "Network error. Try again." } };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function AuthDialog({
  open,
  onOpenChange,
  onSuccess,
  reason = "bookmark",
  pendingFirmName,
}: AuthDialogProps) {
  const [tab, setTab] = useState<"register" | "login" | "forgot">(() => defaultTabForReason(reason));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const { title, description } = copyForReason(reason, pendingFirmName);
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

  useEffect(() => {
    if (open) {
      setTab(defaultTabForReason(reason));
      setError(null);
      setInfo(null);
      setCaptchaResetKey((k) => k + 1);
    }
  }, [open, reason]);

  function bumpCaptcha() {
    turnstileRef.current?.resetWidget();
    setCaptchaResetKey((k) => k + 1);
  }

  function resetSensitiveFields() {
    setPassword("");
    setConfirmPassword("");
    bumpCaptcha();
  }

  function resolveCaptchaToken(): string | null {
    if (!turnstileRequired) return null;
    if (!turnstileRef.current?.isReady()) {
      setError("CAPTCHA is still loading. Wait a moment and try again.");
      return null;
    }
    const token = turnstileRef.current.getToken();
    if (!token) {
      setError("Complete the CAPTCHA check below, then click Sign in.");
      return null;
    }
    return token;
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const captchaToken = resolveCaptchaToken();
    if (turnstileRequired && !captchaToken) return;

    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const { ok, status, data } = await postAuth("/api/auth/register", {
        name: name.trim() || undefined,
        email,
        password,
        confirmPassword,
        captchaToken: captchaToken ?? undefined,
      });
      if (!ok) {
        setError(data.error ?? "Could not create account");
        if (status === 409) setTab("login");
        bumpCaptcha();
        return;
      }
      if (!data.user) {
        setError("Account created but sign-in failed. Try signing in.");
        bumpCaptcha();
        return;
      }
      resetSensitiveFields();
      onSuccess(data.user);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();

    const captchaToken = resolveCaptchaToken();
    if (turnstileRequired && !captchaToken) return;

    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const { ok, data } = await postAuth("/api/auth/login", {
        email,
        password,
        captchaToken: captchaToken ?? undefined,
      });
      if (!ok) {
        setError(data.error ?? "Could not sign in");
        bumpCaptcha();
        return;
      }
      if (!data.user) {
        setError("Signed in but session could not be created. Try again.");
        bumpCaptcha();
        return;
      }
      resetSensitiveFields();
      onSuccess(data.user);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    const captchaToken = resolveCaptchaToken();
    if (turnstileRequired && !captchaToken) return;

    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const { ok, data } = await postAuth("/api/auth/forgot-password", {
        email,
        captchaToken: captchaToken ?? undefined,
      });
      if (!ok) {
        setError(data.error ?? "Could not send reset email");
        bumpCaptcha();
        return;
      }
      setInfo(data.message ?? "If an account exists for that email, we sent a reset link.");
      bumpCaptcha();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tab === "forgot" ? "Reset your password" : title}
          </DialogTitle>
          <DialogDescription>
            {tab === "forgot"
              ? "Enter your account email. If it matches an account, we will send a reset link."
              : description}
          </DialogDescription>
        </DialogHeader>

        {tab === "forgot" ? (
          <form onSubmit={submitForgot} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <TurnstileField
              ref={turnstileRef}
              key={`forgot-captcha-${captchaResetKey}`}
              resetKey={captchaResetKey}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline"
              onClick={() => {
                setTab("login");
                setError(null);
                setInfo(null);
                bumpCaptcha();
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "register" | "login");
            setError(null);
            setInfo(null);
            bumpCaptcha();
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="register">Create account</TabsTrigger>
            <TabsTrigger value="login">Sign in</TabsTrigger>
          </TabsList>

          <TabsContent value="register">
            <form onSubmit={submitRegister} className="space-y-4 pt-2">
              {reason === "bookmark" ? (
                <div className="space-y-2">
                  <Label htmlFor="register-name">Name</Label>
                  <Input
                    id="register-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-confirm">Confirm password</Label>
                <Input
                  id="register-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <TurnstileField
                ref={turnstileRef}
                key={`register-captcha-${captchaResetKey}`}
                resetKey={captchaResetKey}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Creating account…" : "Create free account"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="login">
            <form onSubmit={submitLogin} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                />
              </div>
              <TurnstileField
                ref={turnstileRef}
                key={`login-captcha-${captchaResetKey}`}
                resetKey={captchaResetKey}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => {
                  setTab("forgot");
                  setError(null);
                  setInfo(null);
                  setPassword("");
                  bumpCaptcha();
                }}
              >
                Forgot password?
              </button>
            </form>
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
