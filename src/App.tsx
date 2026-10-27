import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import {
  loadCorrections,
  parseCorrections,
  saveCorrections,
  serializeCorrections,
  type Corrections,
} from './corrections'
import { fingerKey, suggestFingering, type FingerMap, type Hand, type NoteEvent } from './fingering'
import Keyboard, { type KeyFeedback } from './Keyboard'
import MidiLog from './MidiLog'
import SheetMusic from './SheetMusic'
import { flashNoteheads, SCORE_GREEN, SCORE_RED } from './scoreFeedback'
import { paddedRange } from './keyboardLayout'
import { formatMidiEvent, type MidiNoteEvent } from './midi'
import { useKeyboardPiano } from './useKeyboardPiano'
import { useMidi } from './useMidi'
import { readStaff, WaitMode, type HandStaff, type LoopRange, type Target } from './waitMode'

// ?song=name loads /songs/name.musicxml. Without it, VITE_DEFAULT_SONG (set in a local .env.local file) or the Ode to Joy demo.
const SONG_NAME = new URLSearchParams(location.search).get('song') ?? import.meta.env.VITE_DEFAULT_SONG ?? 'ode-to-joy'
const SONG = `/songs/${SONG_NAME}.musicxml`
const MAX_LINES = 10
/** A key keeps its green or red colour this long after you let go of it. */
const KEY_HOLD_MS = 350
const LOOP_KEY = `piano-app:loop:${SONG}`

// The practice loop is remembered per song in the browser; the app works without it (private windows, blocked storage).
function loadLoop(): LoopRange | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(LOOP_KEY) ?? 'null')
    const { start, end } = (data ?? {}) as Partial<LoopRange>
    return Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! >= start! ? { start: start!, end: end! } : null
  } catch {
    return null
  }
}

function saveLoop(loop: LoopRange | null): void {
  try {
    if (loop) localStorage.setItem(LOOP_KEY, JSON.stringify(loop))
    else localStorage.removeItem(LOOP_KEY)
  } catch {
    // Not saved; the loop still works for this session.
  }
}

type HandMode = 'right' | 'left' | 'both'
const HAND_KEY = 'piano-app:hand'

function loadHandMode(): HandMode {
  try {
    const saved = localStorage.getItem(HAND_KEY)
    return saved === 'left' || saved === 'both' ? saved : 'right'
  } catch {
    return 'right'
  }
}

/** The staves to play for a mode; falls back to what the score has (a score may have no left-hand staff). */
function handsFor(mode: HandMode, available: HandStaff[]): HandStaff[] {
  const wanted = available.filter((h) => mode === 'both' || h.hand === mode)
  return wanted.length > 0 ? wanted : available
}

const FINGER_KEYS: Record<string, number> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5,
}

export default function App() {
  const waitModeRef = useRef<WaitMode | null>(null)
  const fingeringRef = useRef<FingerMap>(new Map())
  const entryRef = useRef({ position: '', next: 0 })
  const [lines, setLines] = useState<string[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [pressed, setPressed] = useState<ReadonlyMap<number, KeyFeedback>>(new Map())
  const feedbackCount = useRef(0)
  const releaseTimers = useRef(new Map<number, number>())
  // What the score holds for each hand: the notes to press (for fingering) and the pitch range.
  const [score, setScore] = useState<{
    events: Record<Hand, NoteEvent[]>
    ranges: Partial<Record<Hand, { low: number; high: number }>>
  }>({ events: { right: [], left: [] }, ranges: {} })
  const [handMode, setHandMode] = useState<HandMode>(loadHandMode)
  const availableRef = useRef<HandStaff[]>([])
  const [corrections, setCorrections] = useState<Corrections>(() => loadCorrections(SONG))
  const [loop, setLoop] = useState<LoopRange | null>(loadLoop)
  // Choosing a loop: click its first measure, then its last. 'off' = clicks just jump.
  const [pickPhase, setPickPhase] = useState<'off' | 'start' | 'end'>('off')
  const [pendingStart, setPendingStart] = useState<number | null>(null)

  // Fingers: the player's corrections beat the file's <fingering> tags, and the algorithm fills in the rest.
  const fingering = useMemo(() => {
    const all: FingerMap = new Map()
    for (const hand of ['right', 'left'] as const) {
      const withFixed = score.events[hand].map((e) => ({
        ...e,
        fixed: e.pitches.map((pitch, j) => corrections.get(fingerKey(hand, e.position, pitch)) ?? e.fixed[j]),
      }))
      for (const [key, finger] of suggestFingering(withFixed, hand)) all.set(key, finger)
    }
    return all
  }, [score, corrections])

  // The keyboard shows the range of the hand(s) being played.
  const range = useMemo(() => {
    const active: Hand[] = handMode === 'both' ? ['right', 'left'] : [handMode]
    const ranges = active.map((h) => score.ranges[h]).filter((r) => r !== undefined)
    if (ranges.length === 0) return paddedRange(60, 72)
    return paddedRange(Math.min(...ranges.map((r) => r.low)), Math.max(...ranges.map((r) => r.high)))
  }, [score, handMode])

  useEffect(() => {
    fingeringRef.current = fingering
    waitModeRef.current?.refresh()
  }, [fingering])

  useEffect(() => saveCorrections(SONG, corrections), [corrections])

  // Switching hands keeps your place; if the new hand has nothing to press here, it moves on to the next note.
  useEffect(() => {
    try {
      localStorage.setItem(HAND_KEY, handMode)
    } catch {
      // Not saved; the choice still applies for this session.
    }
    waitModeRef.current?.setHands(handsFor(handMode, availableRef.current))
  }, [handMode])

  // Pressing 1-5 sets the finger of the highlighted notes, lowest first.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const finger = FINGER_KEYS[e.code]
      const waitMode = waitModeRef.current
      if (!finger || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !waitMode) return
      const current = waitMode.targets
      if (current.length === 0) return
      const position = waitMode.position
      if (entryRef.current.position !== position) entryRef.current = { position, next: 0 }
      const target = current[entryRef.current.next % current.length]
      entryRef.current.next += 1
      setCorrections((prev) => new Map(prev).set(fingerKey(target.hand, position, target.pitch), finger))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // → skips the current notes; Esc cancels choosing a loop.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        waitModeRef.current?.skip()
      } else if (e.key === 'Escape') {
        setPickPhase('off')
        setPendingStart(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function applyLoop(range: LoopRange | null) {
    setLoop(range)
    saveLoop(range)
    waitModeRef.current?.setLoop(range) // turning a loop on jumps to its start
  }

  function startPicking() {
    setPendingStart(null)
    setPickPhase('start')
  }

  // A click on the score: choose a loop measure, or jump to that spot.
  function handlePick(spot: { index: number; measure: number }) {
    if (pickPhase === 'start') {
      setPendingStart(spot.measure)
      setPickPhase('end')
    } else if (pickPhase === 'end') {
      const first = pendingStart ?? spot.measure
      setPickPhase('off')
      setPendingStart(null)
      applyLoop({ start: Math.min(first, spot.measure), end: Math.max(first, spot.measure) })
    } else {
      waitModeRef.current?.jumpToPosition(spot.index)
    }
  }

  // One handler for every source of notes: real MIDI and the dev keyboard.
  function handleNote(event: MidiNoteEvent) {
    const line = formatMidiEvent(event)
    console.log(line)
    setLines((prev) => [line, ...prev].slice(0, MAX_LINES))
    // Judge a key when it goes down: a note the player had to play is right (green), anything else is wrong (red).
    // Judging at that moment keeps a right note green while held, even though the cursor has already moved on.
    const waitMode = waitModeRef.current
    const correct = waitMode?.targets.some((t) => t.pitch === event.note) ?? false
    if (event.type === 'noteOn') {
      // Colour the score too, before wait mode moves the cursor on: the note you hit, or the notes you should have hit.
      if (waitMode) flashNoteheads(waitMode.noteheads(correct ? event.note : undefined), correct ? SCORE_GREEN : SCORE_RED)
      window.clearTimeout(releaseTimers.current.get(event.note)) // pressed again while still fading
      releaseTimers.current.delete(event.note)
      const id = ++feedbackCount.current
      setPressed((prev) => new Map(prev).set(event.note, { state: correct ? 'correct' : 'wrong', id }))
    } else {
      // Keep the colour for a moment after release so a quick tap is still seen.
      window.clearTimeout(releaseTimers.current.get(event.note))
      releaseTimers.current.set(
        event.note,
        window.setTimeout(() => {
          releaseTimers.current.delete(event.note)
          setPressed((prev) => {
            if (!prev.has(event.note)) return prev
            const next = new Map(prev)
            next.delete(event.note)
            return next
          })
        }, KEY_HOLD_MS),
      )
    }
    waitMode?.handle(event)
  }

  // Only one listener can own a MIDI input, so MIDI is connected here once.
  const { status, devices } = useMidi(handleNote)
  useKeyboardPiano(handleNote, import.meta.env.DEV)

  function handleReady(osmd: OpenSheetMusicDisplay | null) {
    if (!osmd) {
      waitModeRef.current = null
      setTargets([])
      setScore({ events: { right: [], left: [] }, ranges: {} })
      return
    }
    // One instrument (the piano) with two staves: the top is the right hand, the bottom the left.
    const instrument = osmd.Sheet.Instruments[0]
    const available: HandStaff[] = [{ hand: 'right', staff: instrument.Staves[0] }]
    if (instrument.Staves[1]) available.push({ hand: 'left', staff: instrument.Staves[1] })
    availableRef.current = available

    const events: Record<Hand, NoteEvent[]> = { right: [], left: [] }
    const ranges: Partial<Record<Hand, { low: number; high: number }>> = {}
    for (const h of available) {
      const { events: found, low, high } = readStaff(osmd.cursor, instrument, h)
      events[h.hand] = found
      ranges[h.hand] = { low, high }
    }
    setScore({ events, ranges })
    waitModeRef.current = new WaitMode(
      () => osmd.cursor,
      instrument,
      handsFor(handMode, available),
      setTargets,
      () => fingeringRef.current,
    )
    if (loop) waitModeRef.current.setLoop(loop)
  }

  function exportCorrections() {
    const blob = new Blob([serializeCorrections(SONG, corrections)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${SONG_NAME}-fingering.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importCorrections(file: File | undefined) {
    if (!file) return
    try {
      const imported = parseCorrections(await file.text())
      setCorrections((prev) => new Map([...prev, ...imported]))
    } catch {
      alert('That file is not a fingering export.')
    }
  }

  function clearCorrections() {
    if (corrections.size > 0 && confirm(`Remove all ${corrections.size} fingers you set by hand?`)) {
      setCorrections(new Map())
    }
  }

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, textAlign: 'left' }}>
      <div style={{ flex: 'none', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
        <div role="group" aria-label="Which hand to play" style={{ display: 'flex', gap: 2 }}>
          {([['right', 'Right hand'], ['left', 'Left hand'], ['both', 'Both']] as const).map(([mode, label]) => (
            <button
              key={mode}
              aria-pressed={handMode === mode}
              disabled={mode !== 'right' && score.ranges.left === undefined}
              onClick={() => setHandMode(mode)}
              style={{
                fontWeight: handMode === mode ? 700 : 400,
                background: handMode === mode ? (mode === 'left' ? '#ffb066' : '#6ea8ff') : undefined,
                color: handMode === mode ? '#10131a' : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {pickPhase === 'start' && <span>Loop: click the <b>first</b> measure (Esc cancels)</span>}
        {pickPhase === 'end' && <span>Loop: now click the <b>last</b> measure (Esc cancels)</span>}
        {pickPhase === 'off' && loop && (
          <span>
            Looping measures {loop.start + 1}–{loop.end + 1}
          </span>
        )}
        {pickPhase === 'off' && <button onClick={startPicking}>{loop ? 'New loop…' : 'Loop…'}</button>}
        {pickPhase === 'off' && loop && <button onClick={() => applyLoop(null)}>Stop loop</button>}
        {pickPhase !== 'off' && (
          <button
            onClick={() => {
              setPickPhase('off')
              setPendingStart(null)
            }}
          >
            Cancel
          </button>
        )}
        <span style={{ marginLeft: 'auto' }}>Click the score to jump there · → skips the current notes</span>
      </div>
      {/* The part of the score you are playing: scrolls by itself to keep the cursor in view. */}
      <div
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff', borderRadius: 8, padding: 8 }}
      >
        <SheetMusic
          src={SONG}
          onReady={handleReady}
          onPick={handlePick}
          loop={loop}
          pendingStart={pendingStart}
          picking={pickPhase !== 'off'}
        />
      </div>
      <div style={{ flex: 'none', background: '#fff', borderRadius: 8, padding: 8 }}>
        <Keyboard lowest={range.lowest} highest={range.highest} targets={targets} pressed={pressed} />
      </div>
      <details style={{ flex: 'none', fontSize: 14 }}>
        <summary style={{ cursor: 'pointer' }}>Help, fingering and MIDI</summary>
        <div style={{ maxHeight: '30dvh', overflowY: 'auto' }}>
          <p>
            Wait mode: play the highlighted keys to advance (blue = right hand, orange = left hand; pick a hand
            above). → skips the current notes. Press 1–5 to set the finger of the highlighted note (chords: lowest
            note first).
            {import.meta.env.DEV && ' Dev keys: A W S E D F T G Y H U J K… = piano from middle C, Z/X = octave.'}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
            <span>{corrections.size} fingers set by hand</span>
            <button onClick={exportCorrections} disabled={corrections.size === 0}>
              Export
            </button>
            <label>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  void importCorrections(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button onClick={clearCorrections} disabled={corrections.size === 0}>
              Clear
            </button>
          </div>
          <MidiLog status={status} devices={devices} lines={lines} />
        </div>
      </details>
    </main>
  )
}
