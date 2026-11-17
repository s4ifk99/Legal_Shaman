import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionConstructor,
  isSpeechRecognitionSupported,
  type SpeechRecognitionLike,
} from "../speech";

export type DictationStatus = "idle" | "listening" | "unsupported" | "error";

interface UseDictationOptions {
  lang?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
}

function insecureContextMessage(): string {
  return "Microphone needs a secure page (https:// or localhost). Open http://localhost:3000 and try again.";
}

export function useDictation({ lang = "en-GB", onTranscript }: UseDictationOptions) {
  // Start unsupported so SSR and first client paint match.
  const [status, setStatus] = useState<DictationStatus>("unsupported");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const wantListeningRef = useRef(false);
  const statusRef = useRef<DictationStatus>("unsupported");

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      setStatus("unsupported");
      setErrorMessage(insecureContextMessage());
      return;
    }

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor || !isSpeechRecognitionSupported()) {
      setStatus("unsupported");
      setErrorMessage(
        "Voice dictation isn’t available in this browser. Use Chrome/Edge, or type instead.",
      );
      return;
    }

    setStatus("idle");
    setErrorMessage(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStatus("listening");
      setErrorMessage(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += text;
        else interim += text;
      }
      if (finalChunk) onTranscriptRef.current(finalChunk, true);
      else if (interim) onTranscriptRef.current(interim, false);
    };

    recognition.onerror = (event) => {
      // Benign / transient — keep listening intent if set.
      if (event.error === "aborted") return;
      if (event.error === "no-speech") {
        // Chrome fires this after silence; onend may restart.
        return;
      }

      wantListeningRef.current = false;
      setStatus("error");

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setErrorMessage(
          "Microphone permission blocked. Allow the mic for this site in the browser address bar, then tap Mic again.",
        );
        return;
      }
      if (event.error === "network") {
        setErrorMessage(
          "Speech service couldn’t connect (Chrome needs network access). Check you’re online, or type instead.",
        );
        return;
      }
      if (event.error === "audio-capture") {
        setErrorMessage("No microphone found. Plug one in, or type instead.");
        return;
      }
      setErrorMessage(`Mic error (${event.error}). Tap Mic to try again, or type instead.`);
    };

    recognition.onend = () => {
      if (wantListeningRef.current && recognitionRef.current === recognition) {
        window.setTimeout(() => {
          if (!wantListeningRef.current || recognitionRef.current !== recognition) return;
          try {
            recognition.start();
          } catch {
            wantListeningRef.current = false;
            setStatus("idle");
          }
        }, 120);
        return;
      }
      setStatus((s) => (s === "unsupported" ? s : "idle"));
    };

    recognitionRef.current = recognition;
    return () => {
      wantListeningRef.current = false;
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("unsupported");
      setErrorMessage(insecureContextMessage());
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      setStatus("unsupported");
      setErrorMessage(
        "Voice dictation isn’t available in this browser. Use Chrome/Edge, or type instead.",
      );
      return;
    }

    setErrorMessage(null);
    wantListeningRef.current = true;
    // Must start in the same user-gesture turn — do not await getUserMedia first.
    try {
      recognition.start();
      setStatus("listening");
    } catch {
      // Already started, or transient InvalidStateError — treat as listening.
      setStatus("listening");
    }
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    setStatus((s) => (s === "unsupported" ? s : "idle"));
  }, []);

  const toggle = useCallback(() => {
    if (statusRef.current === "listening") stop();
    else start();
  }, [start, stop]);

  return {
    status,
    errorMessage,
    /** API present and page is secure enough to attempt mic. */
    supported: status !== "unsupported",
    listening: status === "listening",
    start,
    stop,
    toggle,
  };
}
