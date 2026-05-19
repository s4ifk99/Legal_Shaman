"use client";

import { useState } from "react";
import { HelpCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Props = {
  question: string;
  loading?: boolean;
  onSubmit: (answer: string) => void;
};

export function ClarifyPrompt({ question, loading, onSubmit }: Props) {
  const [answer, setAnswer] = useState("");

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              One quick clarification helps us match better:
            </p>
            <p className="text-sm text-muted-foreground">{question}</p>
          </div>
        </div>
        <form onSubmit={handle} className="flex gap-2">
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer"
            autoFocus
            disabled={loading}
          />
          <Button type="submit" disabled={loading || answer.trim().length === 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
