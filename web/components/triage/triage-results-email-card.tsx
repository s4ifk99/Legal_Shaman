"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";

type TriageResultsEmailCardProps = {
  sessionId: string;
  mergedQuery: string;
  sections: TriageResultSection[];
};

export function TriageResultsEmailCard({
  sessionId,
  mergedQuery,
  sections,
}: TriageResultsEmailCardProps) {
  const [email, setEmail] = useState("");
  const [reviewConsent, setReviewConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resultCount = sections.reduce((n, s) => n + s.results.length, 0);
  const hasResults = resultCount > 0;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { user?: { email?: string } }) => {
        if (!cancelled && data.user?.email) {
          setEmail((prev) => prev || data.user!.email!);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hasResults) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewConsent || email.trim().length < 5) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/triage/send-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          email: email.trim(),
          reviewConsent: true,
          mergedQuery,
          sections,
        }),
      });
      const payload = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(payload.error || "send_failed");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "send_failed");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card className="border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium text-foreground">Summary sent</p>
            <p className="mt-1 text-muted-foreground">
              Check your inbox for your search summary. If you opted in, Trustpilot may send a
              separate invitation to leave a review.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gold/30 bg-card">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-2">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <div>
            <h3 className="font-medium text-foreground">Email my results</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional — we will send a short summary of your {resultCount} provider
              {resultCount === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="triage-summary-email">Email address</Label>
            <Input
              id="triage-summary-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="triage-review-consent"
              checked={reviewConsent}
              onCheckedChange={(v) => setReviewConsent(v === true)}
              disabled={loading}
            />
            <Label
              htmlFor="triage-review-consent"
              className="cursor-pointer text-sm font-normal leading-relaxed text-muted-foreground"
            >
              Email me a summary of my search results and allow Trustpilot to separately invite me
              to leave a review about Legal Shaman. You can withdraw consent anytime — see our{" "}
              <a href="/privacy" className="text-primary underline-offset-4 hover:underline">
                Privacy Policy
              </a>
              .
            </Label>
          </div>

          {error ? (
            <p className="text-sm text-destructive">
              {error === "feedback_email_disabled"
                ? "Email summaries are not available right now. Please try again later."
                : "We could not send your summary. Please check your email and try again."}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="outline"
            className="border-gold/40"
            disabled={loading || !reviewConsent || email.trim().length < 5}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send summary"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
