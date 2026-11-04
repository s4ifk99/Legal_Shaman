"use client";

import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { messagesFor } from "@/lib/i18n/messages";
import { localeMeta, type LocaleCode } from "@/lib/i18n/locales";

const LISTEN_KEY = "ls_listen";

let activeCode: LocaleCode | null = null;
let generation = 0;
const listeners = new Set<(code: LocaleCode | null) => void>();

function setActive(code: LocaleCode | null) {
  activeCode = code;
  listeners.forEach((listener) => listener(code));
}

function pageText(): string {
  const marked = document.querySelector("[data-read-aloud]");
  const main = document.querySelector("main");
  const source = (marked ?? main ?? document.body) as HTMLElement;
  const clone = source.cloneNode(true) as HTMLElement;
  if (!marked && !main) {
    clone.querySelectorAll("header, footer").forEach((node) => node.remove());
  }
  clone.querySelectorAll("script, style, svg, nav, [data-no-read]").forEach((node) => node.remove());
  clone.querySelectorAll("h1, h2, h3, h4, p, li, tr").forEach((node) => {
    node.insertAdjacentText("beforebegin", "\n");
  });
  return (clone.textContent || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function chunks(text: string, size = 2400): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = rest.lastIndexOf(" ", size);
    if (cut < 1) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const wanted = lang.toLowerCase();
  const prefix = wanted.split("-")[0];
  return (
    voices.find((voice) => voice.lang.toLowerCase() === wanted) ??
    voices.find((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(`${prefix}-`)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ??
    null
  );
}

export function stopSpeaking() {
  generation += 1;
  window.speechSynthesis?.cancel();
  setActive(null);
}

export function primeSpeech() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const primer = new SpeechSynthesisUtterance(".");
  primer.volume = 0;
  primer.rate = 2;
  synth.speak(primer);
}

export function rememberListen(code: LocaleCode) {
  sessionStorage.setItem(LISTEN_KEY, code);
}

export function clearListen() {
  sessionStorage.removeItem(LISTEN_KEY);
}

export function startSpeaking(code: LocaleCode) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const token = ++generation;
  const text = pageText();
  if (!text) {
    setActive(null);
    return;
  }
  synth.cancel();
  const meta = localeMeta(code);
  const voice = pickVoice(meta.html);
  const parts = chunks(text);
  setActive(code);
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = meta.html;
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (token === generation && index === parts.length - 1) setActive(null);
    };
    utterance.onerror = (event) => {
      if (token !== generation) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      generation += 1;
      synth.cancel();
      setActive(null);
    };
    synth.speak(utterance);
  });
  window.setTimeout(() => {
    if (token !== generation) return;
    if (!synth.speaking && !synth.pending) setActive(null);
  }, 500);
}

export function useSpeaking(): LocaleCode | null {
  const [speaking, setSpeaking] = useState<LocaleCode | null>(activeCode);
  useEffect(() => {
    listeners.add(setSpeaking);
    return () => {
      listeners.delete(setSpeaking);
    };
  }, []);
  return speaking;
}

export function useQueuedListen(locale: LocaleCode) {
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    const wanted = sessionStorage.getItem(LISTEN_KEY);
    if (wanted !== locale) return;
    sessionStorage.removeItem(LISTEN_KEY);
    const timer = window.setTimeout(() => {
      startSpeaking(locale);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [locale]);
}

export function ListenButton({
  code,
  pressed,
  onPress,
}: {
  code: LocaleCode;
  pressed: boolean;
  onPress: () => void;
}) {
  const copy = messagesFor(code);
  const meta = localeMeta(code);
  return (
    <button
      type="button"
      lang={meta.html}
      aria-pressed={pressed}
      aria-label={`${pressed ? copy.stopListening : copy.listen}, ${meta.label}`}
      onClick={onPress}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {pressed ? <Square className="h-3 w-3" aria-hidden /> : <Volume2 className="h-3 w-3" aria-hidden />}
      {pressed ? copy.stopListening : copy.listen}
    </button>
  );
}
