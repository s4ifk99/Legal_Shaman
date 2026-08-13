import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useDictation } from '@/lib/coherence/hooks/useDictation'
import './InputBar.css'

interface Props {
  onSubmit: (value: string) => void
  disabled?: boolean
}

export function InputBar({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState('')
  const baseBeforeInterimRef = useRef('')
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    const chunk = text.trim()
    if (!chunk) return

    if (isFinal) {
      const base = baseBeforeInterimRef.current
      const next = base ? `${base.trimEnd()} ${chunk}` : chunk
      baseBeforeInterimRef.current = next
      setValue(next)
      return
    }

    // Interim: show live words without locking them in
    const base = baseBeforeInterimRef.current
    const next = base ? `${base.trimEnd()} ${chunk}` : chunk
    setValue(next)
  }, [])

  const { listening, supported, errorMessage, toggle, stop } = useDictation({
    lang: 'en-GB',
    onTranscript: handleTranscript,
  })

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (listening) stop()
    onSubmit(trimmed)
    setValue('')
    baseBeforeInterimRef.current = ''
  }

  function onForm(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function onMicClick() {
    if (disabled) return
    if (!listening) {
      // Snapshot current typed text as the base for new speech
      baseBeforeInterimRef.current = valueRef.current.trim()
    }
    toggle()
  }

  return (
    <div className="inputbar-wrap">
      <form className="inputbar" onSubmit={onForm}>
        <label className="visually-hidden" htmlFor="intake-input">
          Your answer
        </label>
        <textarea
          id="intake-input"
          className="inputbar__field"
          rows={2}
          placeholder={
            listening
              ? 'Listening… speak about what happened'
              : 'Type your answer here — or use the microphone'
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (!listening) baseBeforeInterimRef.current = e.target.value
          }}
          onKeyDown={onKey}
          disabled={disabled}
          aria-describedby={errorMessage ? 'dictation-status' : undefined}
        />

        {supported && (
          <button
            type="button"
            className={['inputbar__mic', listening ? 'inputbar__mic--live' : ''].filter(Boolean).join(' ')}
            onClick={onMicClick}
            disabled={disabled}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictation' : 'Dictate with microphone'}
            title={listening ? 'Stop listening' : 'Dictate what happened'}
          >
            <MicIcon listening={listening} />
            <span className="inputbar__mic-label">{listening ? 'Stop' : 'Mic'}</span>
          </button>
        )}

        <button type="submit" className="inputbar__send" disabled={disabled || !value.trim()}>
          Continue
        </button>
      </form>

      {(listening || errorMessage || !supported) && (
        <p
          id="dictation-status"
          className={['inputbar__status', errorMessage ? 'inputbar__status--error' : ''].filter(Boolean).join(' ')}
          role="status"
        >
          {errorMessage
            ? errorMessage
            : listening
              ? 'Listening — your words will appear above. Tap Stop when finished, then Continue.'
              : !supported
                ? 'Voice dictation is not available in this browser. Please type instead.'
                : null}
        </p>
      )}
    </div>
  )
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg
      className="inputbar__mic-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    >
      {listening ? (
        <>
          <rect x="6" y="6" width="12" height="12" />
        </>
      ) : (
        <>
          <rect x="9" y="2" width="6" height="11" rx="0" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v4" />
          <path d="M8 22h8" />
        </>
      )}
    </svg>
  )
}
