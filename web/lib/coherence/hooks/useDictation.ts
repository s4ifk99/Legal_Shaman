import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSpeechRecognitionConstructor,
  isSpeechRecognitionSupported,
  type SpeechRecognitionLike,
} from '../speech'

export type DictationStatus = 'idle' | 'listening' | 'unsupported' | 'error'

interface UseDictationOptions {
  lang?: string
  onTranscript: (text: string, isFinal: boolean) => void
}

export function useDictation({ lang = 'en-GB', onTranscript }: UseDictationOptions) {
  const [status, setStatus] = useState<DictationStatus>(() =>
    isSpeechRecognitionSupported() ? 'idle' : 'unsupported',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const wantListeningRef = useRef(false)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    const Ctor = getSpeechRecognitionConstructor()
    if (!Ctor) {
      setStatus('unsupported')
      return
    }

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus('listening')
      setErrorMessage(null)
    }

    recognition.onresult = (event) => {
      let interim = ''
      let finalChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) finalChunk += text
        else interim += text
      }
      if (finalChunk) onTranscriptRef.current(finalChunk, true)
      else if (interim) onTranscriptRef.current(interim, false)
    }

    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      wantListeningRef.current = false
      setStatus('error')
      if (event.error === 'not-allowed') {
        setErrorMessage('Microphone permission blocked. Allow the mic, or type instead.')
      } else {
        setErrorMessage('Could not hear that. Try again, or type instead.')
      }
    }

    recognition.onend = () => {
      // Some browsers end after a pause; restart if user still wants listening
      if (wantListeningRef.current) {
        try {
          recognition.start()
        } catch {
          wantListeningRef.current = false
          setStatus('idle')
        }
      } else {
        setStatus((s) => (s === 'unsupported' ? s : 'idle'))
      }
    }

    recognitionRef.current = recognition
    return () => {
      wantListeningRef.current = false
      try {
        recognition.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [lang])

  const start = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) {
      setStatus('unsupported')
      setErrorMessage('Voice dictation is not supported in this browser. Please type instead.')
      return
    }
    setErrorMessage(null)
    wantListeningRef.current = true
    try {
      recognition.start()
      setStatus('listening')
    } catch {
      // Already started
      setStatus('listening')
    }
  }, [])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    try {
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    setStatus((s) => (s === 'unsupported' ? s : 'idle'))
  }, [])

  const toggle = useCallback(() => {
    if (status === 'listening') stop()
    else start()
  }, [status, start, stop])

  return {
    status,
    errorMessage,
    supported: status !== 'unsupported',
    listening: status === 'listening',
    start,
    stop,
    toggle,
  }
}
