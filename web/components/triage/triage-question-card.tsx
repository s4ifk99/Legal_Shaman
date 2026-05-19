"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TriageQuestion } from "@/lib/legal-search/triage/types";
import { useState } from "react";

type TriageQuestionCardProps = {
  question: TriageQuestion;
  loading?: boolean;
  onAnswer: (value: string) => void;
  onSkip?: () => void;
};

export function TriageQuestionCard({
  question,
  loading,
  onAnswer,
  onSkip,
}: TriageQuestionCardProps) {
  const [freeText, setFreeText] = useState("");

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-medium text-foreground">{question.prompt}</p>
      {question.chips?.length ? (
        <div className="flex flex-wrap gap-2">
          {question.chips.map((chip) => (
            <Button
              key={chip.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => onAnswer(chip.value)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = freeText.trim();
            if (v) onAnswer(v);
          }}
        >
          <Input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Type your answer…"
            disabled={loading}
            className="max-w-md"
          />
          <Button type="submit" size="sm" disabled={loading || !freeText.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
          </Button>
        </form>
      )}
      {question.allowSkip && onSkip ? (
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onSkip}>
          Skip
        </Button>
      ) : null}
    </div>
  );
}
