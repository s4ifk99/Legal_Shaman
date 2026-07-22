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

export type AuthDialogReason = "bookmark" | "search" | "login";

type AuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (user: PublicUser) => void;
  reason?: AuthDialogReason;
  pendingFirmName?: string;
};

function defaultTabForReason(reason: AuthDialogReason): "register" | "login" {
  return reason === "login" ? "login" : "register";
}

function copyForReason(reason: AuthDialogReason, pendingFirmName?: string) {
  if (reason === "search") {
    return {
      title: "Create a free account to view results",
      description:
        "Sign up with your email and password to see lawyer matches, guidance, and directory results.",
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

export function AuthDialog({
  open,
  onOpenChange,
  onSuccess,
  reason = "bookmark",
  pendingFirmName,
}: AuthDialogProps) {
  const [tab, setTab] = useState<"register" | "login">(() => defaultTabForReason(reason));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const { title, description } = copyForReason(reason, pendingFirmName);
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

  // Align the active tab whenever the dialog opens for a new reason.
  useEffect(() => {
    if (open) {
      setTab(defaultTabForReason(reason));
      setError(null);
      setCaptchaResetKey((k) => k + 1);
    }
  }, [open, reason]);

  function bumpCaptcha() {
    setCaptchaResetKey((k) => k + 1);
  }

  function resetSensitiveFields() {
    setPassword("");
    setConfirmPassword("");
    bumpCaptcha();
  }

  async function resolveCaptchaToken(): Promise<string | undefined> {
    if (!turnstileRequired) return undefined;
    try {
      return await turnstileRef.current?.runChallenge();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Complete the CAPTCHA verification";
      setError(
        message.includes("timed out") || message.includes("expired")
          ? "CAPTCHA timed out. Click Sign in again to retry."
          : "Complete the CAPTCHA verification",
      );
      return undefined;
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = await resolveCaptchaToken();
      if (turnstileRequired && !captchaToken) {
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email,
          password,
          confirmPassword,
          captchaToken,
        }),
      });
      const data = (await res.json()) as { user?: PublicUser; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create account");
        if (res.status === 409) setTab("login");
        bumpCaptcha();
        return;
      }
      if (data.user) {
        resetSensitiveFields();
        onSuccess(data.user);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = await resolveCaptchaToken();
      if (turnstileRequired && !captchaToken) {
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          captchaToken,
        }),
      });
      const data = (await res.json()) as {
        user?: PublicUser;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not sign in");
        bumpCaptcha();
        return;
      }
      if (data.user) {
        resetSensitiveFields();
        onSuccess(data.user);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "register" | "login");
            setError(null);
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
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <TurnstileField
          ref={turnstileRef}
          key={`auth-captcha-${captchaResetKey}`}
          resetKey={captchaResetKey}
        />
        {turnstileRequired ? (
          <p className="text-xs text-muted-foreground">
            CAPTCHA runs when you click Sign in or Create account.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
