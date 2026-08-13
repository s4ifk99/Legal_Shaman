import { useEffect, useRef, useState } from 'react'
import './LoadingScreen.css'

type Phase = 'idle' | 'compiling' | 'grounding' | 'sharpening'

type Props = {
  phase?: Phase
}

/** Pixel-art scales of justice drawn to an offscreen bitmap, then spun. */
function drawScalesBitmap(ctx: CanvasRenderingContext2D, size: number) {
  const s = size / 32
  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = false

  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s))
  }

  const ink = '#1f5c45'
  const mid = '#2f7a5c'
  const gold = '#c9a227'
  const goldDark = '#9a7a1c'
  const pan = '#163d2f'

  // Pillar / stem
  px(15, 6, 2, 20, ink)
  px(14, 25, 4, 2, ink)
  px(12, 27, 8, 2, mid)

  // Crossbeam
  px(6, 8, 20, 2, ink)
  px(5, 7, 2, 3, goldDark)
  px(25, 7, 2, 3, goldDark)

  // Fulcrum diamond
  px(14, 5, 4, 2, gold)
  px(15, 4, 2, 1, gold)
  px(15, 7, 2, 1, goldDark)

  // Left chain
  px(7, 10, 1, 5, mid)
  px(8, 10, 1, 5, mid)
  // Right chain
  px(23, 10, 1, 5, mid)
  px(24, 10, 1, 5, mid)

  // Left pan (slightly up)
  px(4, 14, 8, 1, pan)
  px(5, 15, 6, 1, pan)
  px(6, 16, 4, 1, goldDark)

  // Right pan (slightly down)
  px(20, 15, 8, 1, pan)
  px(21, 16, 6, 1, pan)
  px(22, 17, 4, 1, goldDark)

  // Balance weights hint
  px(7, 13, 2, 1, gold)
  px(23, 14, 2, 1, gold)
}

/** Floor / soft ceiling per phase — bar approaches ceiling, never finishes early. */
function phaseBounds(phase: Phase, elapsedMs = 0): { floor: number; ceiling: number } {
  if (phase === 'grounding') return { floor: 28, ceiling: 62 }
  if (phase === 'sharpening') {
    // After ~20s of synthesis, keep crawling toward 99% so the bar does not look stuck at 92%.
    const late = elapsedMs > 20_000
    return { floor: 58, ceiling: late ? 99 : 92 }
  }
  if (phase === 'idle') return { floor: 8, ceiling: 40 }
  return { floor: 4, ceiling: 32 }
}

const STEPS = [
  { id: 'compiling', label: 'Brief' },
  { id: 'grounding', label: 'Retrieve' },
  { id: 'sharpening', label: 'Synthesise' },
] as const

function stepIndex(phase: Phase): number {
  if (phase === 'grounding') return 1
  if (phase === 'sharpening') return 2
  return 0
}

export function LoadingScreen({ phase = 'compiling' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spriteRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef(0)
  const angleRef = useRef(0)
  const progressRef = useRef(4)
  const phaseStartedRef = useRef(performance.now())
  const [progress, setProgress] = useState(4)

  useEffect(() => {
    phaseStartedRef.current = performance.now()
    const { floor } = phaseBounds(phase, 0)
    if (progressRef.current < floor) {
      progressRef.current = floor
      setProgress(floor)
    }
  }, [phase])

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - phaseStartedRef.current)
      const { floor, ceiling } = phaseBounds(phase, elapsed)
      // Asymptotic ease toward ceiling (~45s to near-cap within phase)
      const t = 1 - Math.exp(-elapsed / 18_000)
      const target = floor + (ceiling - floor) * t
      // Slow crawl so it always feels alive even near the ceiling
      const crawl = Math.min(ceiling - 0.15, progressRef.current + (elapsed > 25_000 ? 0.06 : 0.035))
      const next = Math.max(progressRef.current, Math.min(ceiling, Math.max(target, crawl)))
      progressRef.current = next
      setProgress(next)
      if (!reduced) raf = requestAnimationFrame(tick)
    }

    if (reduced) {
      const { floor, ceiling } = phaseBounds(phase, 0)
      const mid = (floor + ceiling) / 2
      progressRef.current = mid
      setProgress(mid)
      return
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const SIZE = 128
    canvas.width = SIZE
    canvas.height = SIZE

    if (!spriteRef.current) {
      const off = document.createElement('canvas')
      off.width = SIZE
      off.height = SIZE
      const octx = off.getContext('2d')
      if (octx) {
        octx.imageSmoothingEnabled = false
        drawScalesBitmap(octx, SIZE)
        spriteRef.current = off
      }
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const paint = (angle: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.translate(SIZE / 2, SIZE / 2)
      ctx.rotate(angle)
      ctx.imageSmoothingEnabled = false
      if (spriteRef.current) {
        ctx.drawImage(spriteRef.current, -SIZE / 2, -SIZE / 2)
      }
      ctx.restore()
    }

    if (reduced) {
      paint(0)
      return
    }

    let raf = 0
    const tick = () => {
      angleRef.current += 0.045
      frameRef.current += 1
      const wobble = Math.sin(angleRef.current * 2) * 0.08
      paint(angleRef.current + wobble)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const status =
    phase === 'grounding'
      ? 'Checking results against guidance…'
      : phase === 'sharpening'
        ? progress >= 92
          ? 'Still synthesising — almost there…'
          : 'Synthesising your recommendation…'
        : phase === 'idle'
          ? 'Working…'
          : 'Reading your brief…'

  const activeStep = stepIndex(phase)
  const pct = Math.round(progress)

  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-screen__stage">
        <canvas
          ref={canvasRef}
          className="loading-screen__bitmap"
          width={128}
          height={128}
          aria-hidden
        />
        <p className="loading-screen__status">{status}</p>

        <div className="loading-screen__progress" aria-hidden={false}>
          <div
            className="loading-screen__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Agent progress"
          >
            <div className="loading-screen__fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="loading-screen__progress-meta">
            <ol className="loading-screen__steps">
              {STEPS.map((step, i) => (
                <li
                  key={step.id}
                  className={[
                    'loading-screen__step',
                    i < activeStep ? 'is-done' : '',
                    i === activeStep ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {step.label}
                </li>
              ))}
            </ol>
            <span className="loading-screen__pct">{pct}%</span>
          </div>
        </div>

        <p className="loading-screen__hint">
          {phase === 'sharpening'
            ? 'Wiki synthesis can take 1–2 minutes on longer stories — please keep this tab open.'
            : 'Long stories can take up to a minute — please keep this tab open.'}
        </p>
      </div>
      <p className="loading-screen__motto">Justice Through Search</p>
    </div>
  )
}
