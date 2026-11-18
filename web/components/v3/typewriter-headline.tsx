"use client";

import { useEffect, useState } from "react";

const LINES = [
  "what problem do you need help resolving today?",
  "financing a builder dispute",
  "what is litigation financing",
  "small claims",
  "landlord will not return my deposit",
  "employment tribunal where do i start?",
  "debt collector letters i do not understand",
  "family breakdown who can help for free?",
  "housing disrepair and what to do next",
  "need a solicitor or is legal aid enough?",
];

type Props = {
  className?: string;
  lines?: string[];
};

/**
 * Types a line, pauses, deletes it, then moves to the next.
 * Respects prefers-reduced-motion (shows first line static).
 */
export function TypewriterHeadline({ className, lines = LINES }: Props) {
  const [lineIndex, setLineIndex] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"typing" | "hold" | "deleting">("typing");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setText(lines[0] ?? "");
      return;
    }

    const full = lines[lineIndex] ?? "";
    let timeout: number;

    if (phase === "typing") {
      if (text.length < full.length) {
        timeout = window.setTimeout(() => {
          setText(full.slice(0, text.length + 1));
        }, 95 + Math.random() * 55);
      } else {
        timeout = window.setTimeout(() => setPhase("hold"), 3200);
      }
    } else if (phase === "hold") {
      timeout = window.setTimeout(() => setPhase("deleting"), 600);
    } else {
      if (text.length > 0) {
        timeout = window.setTimeout(() => {
          setText(text.slice(0, -1));
        }, 42);
      } else {
        timeout = window.setTimeout(() => {
          setLineIndex((i) => (i + 1) % lines.length);
          setPhase("typing");
        }, 450);
      }
    }

    return () => window.clearTimeout(timeout);
  }, [text, phase, lineIndex, lines, reduceMotion]);

  return (
    <h1 className={className} aria-live="polite">
      <span className="sr-only">{lines[0]}</span>
      <span aria-hidden="true">
        {text}
        {!reduceMotion ? (
          <span className="ml-0.5 inline-block w-[0.08em] animate-pulse bg-foreground align-[-0.05em]">
            &nbsp;
          </span>
        ) : null}
      </span>
    </h1>
  );
}
