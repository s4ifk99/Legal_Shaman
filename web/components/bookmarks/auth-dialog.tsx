"use client";

import { useCallback, useEffect, useState } from "react";
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
import { TurnstileField } from "@/components/auth/turnstile-field";

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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { title, description } = copyForReason(reason, pendingFirmName);
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

  // Align the active tab whenever the dialog opens for a new reason.
  useEffect(() => {
    if (open) {
      setTab(defaultTabForReason(reason));
      setError(null);
      setCaptchaToken(null);
      setCaptchaResetKey((k) => k + 1);
    }
  }, [open, reason]);

  const handleCaptchaChange = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  function bumpCaptcha() {
    setCaptchaToken(null);
    setCaptchaResetKey((k) => k + 1);
  }

  function resetSensitiveFields() {
    setPassword("");
    setConfirmPassword("");
    bumpCaptcha();
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (turnstileRequired && !captchaToken) {
      setError("Complete the CAPTCHA verification");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email,
          password,
          confirmPassword,
          captchaToken: captchaToken ?? undefined,
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
    if (turnstileRequired && !captchaToken) {
      setError("Complete the CAPTCHA verification");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          captchaToken: captchaToken ?? undefined,
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
              <TurnstileField
                key={`register-captcha-${captchaResetKey}`}
                onTokenChange={handleCaptchaChange}
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
                key={`login-captcha-${captchaResetKey}`}
                onTokenChange={handleCaptchaChange}
                resetKey={captchaResetKey}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
