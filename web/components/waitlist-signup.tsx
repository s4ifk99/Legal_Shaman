"use client";

import { useState } from "react";
import { Mail, Check, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpiralDecoration } from "./spiral-decoration";

export function WaitlistSignup() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
      setEmail("");
      setTimeout(() => setSubmitted(false), 5000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl border-2 border-gold/30 bg-accent/10 p-6 md:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Check className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">You&apos;re on the waitlist!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll email you as soon as Legal Shaman is officially launched.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <div className="relative flex-1">
          <Input
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="border-2 border-gold/30 bg-card text-base focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          <Mail className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-[1.02] transition-all shadow-lg whitespace-nowrap"
          size="lg"
        >
          <Sparkles className="h-5 w-5" />
          {loading ? "Joining..." : "Join Waitlist"}
        </Button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
    </form>
  );
}
