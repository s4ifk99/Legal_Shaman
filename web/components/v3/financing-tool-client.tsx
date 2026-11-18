"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { resolveApiUrl } from "@/lib/site/api-url";

type Option = {
  id: string;
  title: string;
  blurb: string;
  likelihood?: string;
  url?: string;
  sourceLabel?: string;
};

type Contact = {
  id: string;
  name: string;
  role: string;
  blurb: string;
  url?: string;
};

const KINDS = [
  { id: "general", label: "General / other" },
  { id: "housing", label: "Housing" },
  { id: "employment", label: "Employment" },
  { id: "consumer", label: "Consumer" },
  { id: "debt", label: "Debt" },
  { id: "divorce", label: "Family / divorce" },
  { id: "neighbour", label: "Neighbour" },
  { id: "benefits", label: "Benefits / UC" },
] as const;

const PREFS = [
  { id: "", label: "Not sure yet" },
  { id: "legal_aid", label: "Legal aid" },
  { id: "pro_bono", label: "Free / pro bono" },
  { id: "insurance", label: "Insurance / union" },
  { id: "fixed_fee", label: "Fixed fee" },
  { id: "private", label: "Private pay" },
  { id: "unsure", label: "Unsure" },
] as const;

export function FinancingToolClient({
  initialKind,
  initialStory,
  initialPreference,
}: {
  initialKind: string;
  initialStory: string;
  initialPreference: string;
}) {
  const [kind, setKind] = useState(initialKind || "general");
  const [story, setStory] = useState(initialStory || "");
  const [preference, setPreference] = useState(initialPreference || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complexity, setComplexity] = useState<string | null>(null);
  const [complexityReason, setComplexityReason] = useState<string | null>(null);
  const [honestNote, setHonestNote] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const run = useCallback(async () => {
    const trimmed = story.trim();
    if (trimmed.length < 12) {
      setError("Describe the dispute in a short paragraph so we can map financing routes.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(resolveApiUrl("/api/cases/recommend-financing"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          story: trimmed,
          preference: preference || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        complexity?: string;
        complexityReason?: string;
        honestNote?: string;
        options?: Option[];
        contacts?: Contact[];
      };
      if (!res.ok) {
        setError(data.error || "Could not build a financing map.");
        return;
      }
      setComplexity(data.complexity || null);
      setComplexityReason(data.complexityReason || null);
      setHonestNote(data.honestNote || null);
      setOptions(data.options || []);
      setContacts(data.contacts || []);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }, [kind, story, preference]);

  useEffect(() => {
    if (initialStory.trim().length >= 12) {
      void run();
    }
    // Prefill-only auto-run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-4">
        <label className="block text-sm font-medium text-foreground">
          Area of law
          <select
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-foreground">
          What is the dispute? (include claim value / complexity if you know it)
          <textarea
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm min-h-[120px]"
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder="e.g. Landlord withheld £1,800 deposit after I left; TDS scheme letter received…"
          />
        </label>

        <label className="block text-sm font-medium text-foreground">
          Funding preference (optional)
          <select
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
          >
            {PREFS.map((p) => (
              <option key={p.id || "none"} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? "Mapping routes…" : "Map financing options"}
        </button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {complexity ? (
        <div className="rounded-2xl border border-gold/30 bg-card p-5 space-y-3">
          <p className="text-sm">
            <span className="font-semibold text-foreground">Complexity: </span>
            <span className="capitalize text-primary">{complexity}</span>
          </p>
          {complexityReason ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{complexityReason}</p>
          ) : null}
          {honestNote ? (
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
              {honestNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {options.length ? (
        <section className="space-y-3">
          <h2 className="font-serif text-xl font-semibold text-foreground">Routes to consider</h2>
          <ul className="space-y-3">
            {options.map((o) => (
              <li
                key={o.id}
                className="rounded-2xl border border-border/70 bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-foreground">{o.title}</h3>
                  {o.likelihood ? (
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {o.likelihood}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{o.blurb}</p>
                {o.url ? (
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {o.sourceLabel || "Learn more"} →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contacts.length ? (
        <section className="space-y-3">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Specialist contacts (selective)
          </h2>
          <p className="text-xs text-muted-foreground">
            Funders and brokers are selective — many consumer disputes will not qualify. Use as
            research leads only.
          </p>
          <ul className="space-y-3">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-border/70 bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-foreground">{c.name}</h3>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {c.role}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{c.blurb}</p>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Visit site →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Prefer a guided chat?{" "}
        <Link href="/ask-the-shaman" className="font-medium text-primary underline-offset-2 hover:underline">
          Ask the Shaman
        </Link>{" "}
        can read letters and build a full action plan. Or browse{" "}
        <Link href="/blog" className="font-medium text-primary underline-offset-2 hover:underline">
          Blog / wiki guides
        </Link>
        .
      </p>
    </div>
  );
}
