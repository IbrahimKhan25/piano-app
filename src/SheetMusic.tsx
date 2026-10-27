import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { LoopRange } from './waitMode'

/** Where one cursor position sits on the page (pixels, relative to the score). */
type Spot = { measure: number; x: number; top: number; height: number }

type Props = {
  /** URL of a MusicXML file, e.g. "/songs/ode-to-joy.musicxml" */
  src: string
  /** Called with the rendered OSMD instance once the score is ready, and with null when it is torn down. */
  onReady?: (osmd: OpenSheetMusicDisplay | null) => void
  /** Called when the score is clicked: the nearest cursor position (counting from 0) and its measure (0-based). */
  onPick?: (spot: { index: number; measure: number }) => void
  /** Measures to highlight as the practice loop. */
  loop?: LoopRange | null
  /** A measure chosen as the loop's start while its end is still being chosen. */
  pendingStart?: number | null
  /** True while the player is choosing loop measures (changes the mouse pointer). */
  picking?: boolean
}

/** The closest ancestor that scrolls vertically, if any. */
function nearestScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

// Walk the whole piece once and note where the cursor sits at each position, then put the cursor back at the start.
function readSpots(osmd: OpenSheetMusicDisplay): Spot[] {
  const cursor = osmd.cursor
  const el = cursor.cursorElement
  const spots: Spot[] = []
  cursor.reset()
  while (!cursor.iterator.EndReached) {
    spots.push({
      measure: cursor.iterator.CurrentMeasureIndex,
      x: parseFloat(el.style.left) || 0,
      top: parseFloat(el.style.top) || 0,
      height: parseFloat(el.style.height) || 0,
    })
    cursor.next()
  }
  cursor.reset()
  return spots
}

// Put the cursor back at a time in the score (used after the score is drawn again at a new size).
function restoreCursor(osmd: OpenSheetMusicDisplay, time: number) {
  const cursor = osmd.cursor
  cursor.reset()
  while (!cursor.iterator.EndReached && cursor.iterator.CurrentSourceTimestamp.RealValue < time - 1e-9) {
    cursor.iterator.moveToNext()
  }
  cursor.update()
}

type Band = { left: number; top: number; width: number; height: number; kind: 'loop' | 'pending' }

/** Rectangles covering a measure, one per line of music it appears on. */
function bandsFor(spots: Spot[], measure: number, kind: Band['kind']): Band[] {
  const mine = spots.filter((s) => s.measure === measure)
  const next = spots.filter((s) => s.measure === measure + 1)
  const lines = new Map<number, Spot[]>()
  for (const s of mine) lines.set(Math.round(s.top), [...(lines.get(Math.round(s.top)) ?? []), s])
  return [...lines.values()].map((group) => {
    const minX = Math.min(...group.map((s) => s.x))
    const maxX = Math.max(...group.map((s) => s.x))
    const sameLineNext = next.filter((s) => Math.abs(s.top - group[0].top) < 2)
    const left = minX - 14
    const right = sameLineNext.length > 0 ? Math.min(...sameLineNext.map((s) => s.x)) - 14 : maxX + 50
    return { left, top: group[0].top, width: Math.max(0, right - left), height: group[0].height, kind }
  })
}

export default function SheetMusic({ src, onReady, onPick, loop, pendingStart, picking }: Props) {
  // OSMD draws into a real DOM element, so we keep a handle to it with a ref.
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const spotsRef = useRef<Spot[]>([])
  const [spots, setSpots] = useState<Spot[]>([])

  // Latest callbacks in refs so a new function identity doesn't re-render the score.
  const onReadyRef = useRef(onReady)
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onReadyRef.current = onReady
    onPickRef.current = onPick
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // StrictMode runs this effect twice in dev (mount, cleanup, mount).
    // `cancelled` stops the first run from drawing after it was cleaned up.
    let cancelled = false
    let suspend = false // true while we move the cursor around just to measure it
    let observer: MutationObserver | null = null
    let resizeObserver: ResizeObserver | null = null
    let resizeTimer: number | undefined
    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false, // we redraw on resize ourselves so we can re-measure the cursor positions
      drawTitle: true,
      followCursor: false, // OSMD only scrolls the page; we scroll our own box below
    })
    osmdRef.current = osmd
    if (import.meta.env.DEV) Object.assign(window, { __osmd: osmd }) // handy for poking at the score in the browser console

    // Keep the cursor's line in view: when it leaves the scroll box, glide so its line sits a quarter of the way down.
    // OSMD may replace its cursor element when it re-draws, so watch the whole container and look the cursor up each time.
    function followCursor() {
      const scroller = nearestScroller(container!)
      if (!scroller) return
      observer = new MutationObserver(() => {
        if (suspend) return
        const cursorEl = osmd.cursor.cursorElement
        if (!cursorEl) return
        const box = scroller.getBoundingClientRect()
        const c = cursorEl.getBoundingClientRect()
        if (c.top < box.top + 8 || c.bottom > box.bottom - 8) {
          scroller.scrollTo({ top: scroller.scrollTop + (c.top - box.top) - box.height * 0.25, behavior: 'smooth' })
        }
      })
      // OSMD repositions the cursor by changing its inline style.
      observer.observe(container!, { attributes: true, attributeFilter: ['style'], subtree: true })
    }

    // Measure where every cursor position is, optionally restoring the cursor afterwards.
    function measure(restoreTime: number | null) {
      suspend = true
      const found = readSpots(osmd)
      if (restoreTime !== null) restoreCursor(osmd, restoreTime)
      observer?.takeRecords() // discard the moves we just made so they don't scroll the box
      suspend = false
      spotsRef.current = found
      setSpots(found)
    }

    async function init() {
      await osmd.load(src) // OSMD fetches and parses the MusicXML
      if (cancelled) return
      osmd.render() // draws the SVG
      osmd.cursor.show() // cursor starts on the first time position
      measure(null)
      followCursor()
      onReadyRef.current?.(osmd)

      // Redraw (and re-measure) when the width changes.
      let lastWidth = container!.clientWidth
      resizeObserver = new ResizeObserver(() => {
        const width = container!.clientWidth
        if (width === lastWidth) return
        lastWidth = width
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(() => {
          if (cancelled) return
          const it = osmd.cursor.iterator
          const time = it.EndReached ? Infinity : it.CurrentSourceTimestamp.RealValue
          osmd.render()
          osmd.cursor.show()
          measure(time)
        }, 250)
      })
      resizeObserver.observe(container!)
    }
    init().catch(console.error)

    return () => {
      cancelled = true
      window.clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      observer?.disconnect()
      onReadyRef.current?.(null)
      osmd.clear()
    }
  }, [src])

  function handleClick(e: React.MouseEvent) {
    const found = spotsRef.current
    const cursorEl = osmdRef.current?.cursor.cursorElement
    if (found.length === 0 || !cursorEl || !onPickRef.current) return
    // Spot positions are relative to the element the cursor is placed in.
    const origin = (cursorEl.offsetParent ?? containerRef.current!).getBoundingClientRect()
    const x = e.clientX - origin.left
    const y = e.clientY - origin.top
    // The line of music dominates (a click anywhere on a line picks that line); then the nearest note across.
    let best = 0
    let bestScore = Infinity
    found.forEach((s, i) => {
      const dy = y < s.top ? s.top - y : y > s.top + s.height ? y - (s.top + s.height) : 0
      const score = dy * 1000 + Math.abs(x - s.x)
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })
    onPickRef.current({ index: best, measure: found[best].measure })
  }

  const bands = useMemo(() => {
    const out: Band[] = []
    if (loop) for (let m = loop.start; m <= loop.end; m++) out.push(...bandsFor(spots, m, 'loop'))
    if (pendingStart !== null && pendingStart !== undefined) out.push(...bandsFor(spots, pendingStart, 'pending'))
    return out
  }, [spots, loop, pendingStart])

  return (
    <div style={{ position: 'relative', cursor: picking ? 'crosshair' : 'pointer' }} onClick={handleClick}>
      <div ref={containerRef} />
      {bands.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: b.left,
            top: b.top,
            width: b.width,
            height: b.height,
            pointerEvents: 'none',
            background: b.kind === 'loop' ? 'rgba(80, 140, 255, 0.14)' : 'rgba(255, 170, 40, 0.25)',
            borderLeft: b.kind === 'loop' ? '2px solid rgba(80, 140, 255, 0.5)' : '2px solid rgba(255, 170, 40, 0.8)',
          }}
        />
      ))}
    </div>
  )
}
