"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SpiralDecoration } from "./spiral-decoration";

type BrowserSpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  onresult: ((ev: Event) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecCtor = new () => BrowserSpeechRec;

function getSpeechRecognition(): BrowserSpeechRec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function ProblemAssistant() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [legalAid, setLegalAid] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const startBrowserDictation = useCallback(() => {
    const rec = getSpeechRecognition();
    if (!rec) {
      setVoiceNote("Browser speech recognition is not available in this browser.");
      return;
    }
    setVoiceNote("Listening… speak, then pause when finished.");
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-GB";
    let finalText = "";
    rec.onresult = (ev: Event) => {
      const e = ev as unknown as {
        resultIndex: number;
        results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } };
      };
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r?.isFinal) finalText += r[0]?.transcript ?? "";
      }
    };
    rec.onerror = () => {
      setVoiceNote("Voice input stopped or failed. Try again or type your problem.");
    };
    rec.onend = () => {
      const t = finalText.trim();
      if (t) setProblem((p) => (p.trim() ? `${p.trim()} ${t}` : t));
      setVoiceNote(null);
    };
    try {
      rec.start();
    } catch {
      setVoiceNote("Could not start browser voice input.");
    }
  }, []);

  const onFindHelp = () => {
    const trimmed = problem.trim();
    if (!trimmed) return;
    const params = new URLSearchParams();
    params.set("q", trimmed);
    if (legalAid) params.set("legalAid", "1");
    if (freeOnly) params.set("free", "1");
    router.push(`/search?${params.toString()}`);
  };

  return (
    <section
      id="find-help"
      className="relative overflow-hidden border-t-2 border-gold/30 bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-12 md:py-16"
      aria-labelledby="find-help-heading"
    >
      {/* Decorative spirals */}
      <div className="absolute -left-16 -top-16 opacity-15">
        <SpiralDecoration size={200} color="var(--teal)" />
      </div>
      <div className="absolute -bottom-20 -right-20 opacity-15">
        <SpiralDecoration size={250} color="var(--coral)" />
      </div>
      
      <div className="relative mx-auto max-w-3xl px-4">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent/20 px-4 py-2 text-sm font-medium text-accent-foreground">
            <Sparkles className="h-4 w-4 text-gold" />
            <span>Agentic AI Search</span>
          </div>
          <h2 id="find-help-heading" className="font-serif text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Tell Us Your <span className="text-secondary">Dispute</span>
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            Describe your situation and we&apos;ll point you in the right direction — solicitors, legal aid, free advice, and more.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-xl md:p-8">
          <Textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="e.g. I've been given notice to leave my flat and I'm on a low income…"
            className="min-h-[140px] resize-y border-2 border-primary/20 bg-background text-base focus:border-primary focus:ring-2 focus:ring-gold/30"
            rows={5}
          />

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pa-legal-aid"
                  checked={legalAid}
                  onCheckedChange={(v) => setLegalAid(v === true)}
                  className="border-primary data-[state=checked]:bg-primary"
                />
                <Label htmlFor="pa-legal-aid" className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed">
                  Legal aid needed
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="pa-free" 
                  checked={freeOnly} 
                  onCheckedChange={(v) => setFreeOnly(v === true)}
                  className="border-secondary data-[state=checked]:bg-secondary"
                />
                <Label htmlFor="pa-free" className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed">
                  Free / pro bono only
                </Label>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0 border-gold/50 hover:bg-gold/10 hover:text-foreground"
              onClick={startBrowserDictation}
            >
              <Mic className="h-4 w-4 text-secondary" />
              Voice input
            </Button>
          </div>

          {voiceNote && (
            <p className="mt-4 rounded-lg bg-gold/10 px-4 py-2 text-sm text-foreground">
              {voiceNote}
            </p>
          )}

          <Button
            type="button"
            className="mt-6 w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-[1.02] transition-all shadow-lg"
            size="lg"
            onClick={onFindHelp}
            disabled={!problem.trim()}
          >
            <Search className="h-5 w-5" />
            Search for Help
          </Button>
        </div>
      </div>
    </section>
  );
}
