"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
      className="border-t-2 border-primary/15 bg-background py-10 md:py-12"
      aria-labelledby="find-help-heading"
    >
      <div className="mx-auto max-w-3xl px-4">
        <h2 id="find-help-heading" className="font-serif text-2xl font-semibold tracking-tight text-primary md:text-3xl">
          Tell Us Your Dispute
        </h2>
        <p className="mt-2 text-muted-foreground">
          Describe your situation and we&apos;ll point you in the right direction. Our agentic search finds the best solicitors, legal aid, and free advice for your specific needs. Type or use voice input — no account required.
        </p>

        <div className="mt-6 space-y-4">
          <Textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="e.g. I’ve been given notice to leave my flat and I’m on a low income…"
            className="min-h-[120px] resize-y text-base"
            rows={5}
          />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pa-legal-aid"
                  checked={legalAid}
                  onCheckedChange={(v) => setLegalAid(v === true)}
                />
                <Label htmlFor="pa-legal-aid" className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed">
                  I&apos;m looking for legal aid
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="pa-free" checked={freeOnly} onCheckedChange={(v) => setFreeOnly(v === true)} />
                <Label htmlFor="pa-free" className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed">
                  Prefer free / pro bono services
                </Label>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              onClick={startBrowserDictation}
            >
              <Mic className="h-4 w-4" />
              Browser voice
            </Button>
          </div>

          {voiceNote && <p className="text-sm text-amber-700 dark:text-amber-400">{voiceNote}</p>}

          <Button
            type="button"
            className="w-full gap-2 sm:w-auto"
            size="lg"
            onClick={onFindHelp}
            disabled={!problem.trim()}
          >
            <Search className="h-4 w-4" />
            Search directory
          </Button>
        </div>
      </div>
    </section>
  );
}
