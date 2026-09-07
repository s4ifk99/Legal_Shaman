"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { TurnstileField, type TurnstileHandle } from "@/components/auth/turnstile-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveApiUrl } from "@/lib/site/api-url";

function ResetPasswordForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = useMemo(() => search.get("token")?.trim() || "", [search]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const turnstileRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("This reset link is missing or incomplete. Request a new one from Sign in.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    let captchaToken: string | undefined;
    if (turnstileRequired) {
      if (!turnstileRef.current?.isReady()) {
        setError("CAPTCHA is still loading. Wait a moment and try again.");
        return;
      }
      const t = turnstileRef.current.getToken();
      if (!t) {
        setError("Complete the CAPTCHA check below, then continue.");
        return;
      }
      captchaToken = t;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(resolveApiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword, captchaToken }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error || "Could not update password");
        turnstileRef.current?.resetWidget();
        setCaptchaResetKey((k) => k + 1);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/ask-the-shaman?login=1"), 1200);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-display text-2xl tracking-tight text-foreground">Choose a new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use at least 8 characters. After saving, sign in with your email and new password.
      </p>

      {done ? (
        <p className="mt-6 text-sm text-foreground">Password updated. Redirecting to sign in…</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <TurnstileField
            ref={turnstileRef}
            key={`reset-captcha-${captchaResetKey}`}
            resetKey={captchaResetKey}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={submitting || !token}>
            {submitting ? "Saving…" : "Save new password"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/ask-the-shaman" className="underline underline-offset-2">
          Back to Ask the Shaman
        </Link>
      </p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
