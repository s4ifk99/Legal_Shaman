"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useDictation } from "@/lib/coherence/hooks/useDictation";

type Props = {
  onSubmit: (value: string) => void;
  onUpload?: (file: File) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  allowUpload?: boolean;
};

export function ThirdEyeInput({
  onSubmit,
  onUpload,
  disabled,
  placeholder,
  allowUpload,
}: Props) {
  const [value, setValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const baseBeforeInterimRef = useRef("");
  const valueRef = useRef(value);
  const fileRef = useRef<HTMLInputElement>(null);
  // Textarea stays editable; only Send is briefly gated so long async work never freezes typing.
  const sendBlocked = Boolean(disabled) || sending;

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    const chunk = text.trim();
    if (!chunk) return;

    if (isFinal) {
      const base = baseBeforeInterimRef.current;
      const next = base ? `${base.trimEnd()} ${chunk}` : chunk;
      baseBeforeInterimRef.current = next;
      setValue(next);
      return;
    }

    const base = baseBeforeInterimRef.current;
    const next = base ? `${base.trimEnd()} ${chunk}` : chunk;
    setValue(next);
  }, []);

  const { listening, supported, errorMessage, toggle, stop, status } = useDictation({
    lang: "en-GB",
    onTranscript: handleTranscript,
  });

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || sendBlocked) return;
    if (listening) stop();
    setSending(true);
    setValue("");
    baseBeforeInterimRef.current = "";
    try {
      onSubmit(trimmed);
    } finally {
      // Parent handles long async work; unlock Send on next paint so typing stays free.
      window.requestAnimationFrame(() => setSending(false));
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUpload) return;
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onFormSubmit} className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            baseBeforeInterimRef.current = e.target.value;
          }}
          onKeyDown={onKeyDown}
          rows={6}
          placeholder={placeholder || "Type here — or use the microphone"}
          className="min-h-[10rem] flex-1 resize-y rounded-2xl border-2 border-gold/35 bg-background/70 px-4 py-4 text-base leading-relaxed text-foreground shadow-sm backdrop-blur-sm placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 md:min-h-[12rem]"
          aria-label="Tell us what’s going on"
        />
        <div className="flex gap-2 sm:flex-col">
          {allowUpload ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => void onFileChange(e)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !onUpload}
                className="inline-flex min-w-[5.5rem] flex-1 items-center justify-center rounded-2xl border-2 border-border/80 bg-background/70 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary/40 disabled:opacity-40 sm:flex-none"
                aria-label="Upload a letter, photo, or document"
              >
                {uploading ? "…" : "Upload"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (!supported) return;
              if (!listening) baseBeforeInterimRef.current = valueRef.current;
              toggle();
            }}
            disabled={!supported}
            title={
              !supported
                ? errorMessage || "Voice not available in this browser"
                : listening
                  ? "Stop listening"
                  : "Start dictation"
            }
            className={`inline-flex min-w-[5.5rem] flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition sm:flex-none disabled:cursor-not-allowed disabled:opacity-50 ${
              listening
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/80 bg-background/70 text-foreground hover:border-primary/40"
            }`}
            aria-pressed={listening}
            aria-label={listening ? "Stop dictation" : "Dictate with microphone"}
          >
            {listening ? "Listening" : "Mic"}
          </button>
          <button
            type="submit"
            disabled={sendBlocked || !value.trim()}
            className="inline-flex min-w-[5.5rem] flex-1 items-center justify-center rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40 sm:flex-none"
          >
            Send
          </button>
        </div>
      </div>
      {errorMessage ? (
        <p className="mt-2 text-center text-xs text-primary" role="status">
          {errorMessage}
        </p>
      ) : listening ? (
        <p className="mt-2 text-center text-xs text-foreground/80" role="status">
          Listening — your words appear above. Tap Mic again to stop.
        </p>
      ) : status === "unsupported" ? (
        <p className="mt-2 text-center text-xs text-muted-foreground" role="status">
          Mic needs Chrome/Edge on https:// or localhost. You can still type or Upload.
        </p>
      ) : (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Prefer speaking? Use Mic. Have a letter or photo? Use Upload.
        </p>
      )}
    </form>
  );
}
