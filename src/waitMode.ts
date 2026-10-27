import { TechnicalInstructionType } from 'opensheetmusicdisplay'
import type { Cursor, Instrument, Note, Staff, VexFlowGraphicalNote } from 'opensheetmusicdisplay'
import { fingerKey, type FingerMap, type Hand, type NoteEvent } from './fingering'
import type { MidiNoteEvent } from './midi'

/** A key to press, with the finger to use when known. */
export type Target = {
  /** MIDI note number, 60 = middle C */
  pitch: number
  finger?: number
  hand: Hand
}

/** One hand and the score staff it plays. */
export type HandStaff = { hand: Hand; staff: Staff }

/** True when every required pitch has been pressed. Nothing required means nothing to satisfy. */
export function isSatisfied(required: number[], pressed: ReadonlySet<number>): boolean {
  return required.length > 0 && required.every((p) => pressed.has(p))
}

/** Where the cursor is in the score, independent of how it got there (wait mode or arrow keys). */
export function positionOf(cursor: Cursor): string {
  return cursor.iterator.CurrentSourceTimestamp.RealValue.toFixed(6)
}

// A tie is stored on both notes; only the first one is struck.
function isTiedContinuation(note: Note): boolean {
  return !!note.NoteTie && note.NoteTie.StartNote !== note
}

// Fingerings are stored on the voice entry (the chord), each pointing at its note.
function fingerOf(note: Note): number | undefined {
  const instruction = note.ParentVoiceEntry.TechnicalInstructions.find(
    (t) => t.type === TechnicalInstructionType.Fingering && t.sourceNote === note,
  )
  const finger = instruction ? parseInt(instruction.value, 10) : NaN
  return Number.isNaN(finger) ? undefined : finger
}

/** Notes the player must press at the cursor position, lowest first, for the given hands. Rests and tied continuations need no press. */
export function requiredTargets(cursor: Cursor, instrument: Instrument, hands: HandStaff[]): Target[] {
  const targets: Target[] = []
  const seen = new Set<string>()
  for (const n of cursor.NotesUnderCursor(instrument)) {
    if (n.isRest() || isTiedContinuation(n)) continue
    const owner = hands.find((h) => n.ParentStaffEntry.ParentStaff === h.staff)
    if (!owner) continue
    // OSMD's halfTone counts from C0 = 0 minus an octave: C4 is 48, MIDI wants 60.
    const pitch = n.halfTone + 12
    const key = `${owner.hand}:${pitch}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ pitch, finger: fingerOf(n), hand: owner.hand })
  }
  return targets.sort((a, b) => a.pitch - b.pitch)
}

/**
 * Walks the whole piece once and returns every staff position that needs a key
 * press (with any fingers written in the file) plus the pitch range.
 * The cursor is put back at the start afterwards.
 */
export function readStaff(
  cursor: Cursor,
  instrument: Instrument,
  hand: HandStaff,
): { events: NoteEvent[]; low: number; high: number } {
  const events: NoteEvent[] = []
  let low = Infinity
  let high = -Infinity
  cursor.reset()
  while (!cursor.iterator.EndReached) {
    const targets = requiredTargets(cursor, instrument, [hand])
    if (targets.length > 0) {
      events.push({
        position: positionOf(cursor),
        pitches: targets.map((t) => t.pitch),
        fixed: targets.map((t) => t.finger),
      })
      low = Math.min(low, targets[0].pitch)
      high = Math.max(high, targets[targets.length - 1].pitch)
    }
    cursor.next()
  }
  cursor.reset()
  return { events, low: low <= high ? low : 60, high: low <= high ? high : 72 }
}

/**
 * Wait mode: the cursor advances only once every note at the current
 * position has been pressed. Wrong notes are ignored.
 *
 * We track pitches pressed *since the cursor last moved* (not keys currently
 * held), so a key still held from the previous note can't count for the next
 * one. Repeated notes must be struck again.
 */
export type LoopRange = {
  /** First measure of the loop (0-based, as in OSMD) */
  start: number
  /** Last measure of the loop, inclusive */
  end: number
}

export class WaitMode {
  private loop: LoopRange | null = null
  private pressed = new Set<number>()
  // OSMD makes a new cursor object each time it redraws the score (e.g. on resize), so always ask for the live one.
  private getCursor: () => Cursor
  private instrument: Instrument
  private hands: HandStaff[]
  private onChange: (targets: Target[]) => void
  private fingers: () => FingerMap

  /**
   * `onChange` is called with the notes to play now (with fingers from `fingers()`)
   * each time the cursor settles on a new position, and on `refresh()`.
   */
  constructor(
    getCursor: () => Cursor,
    instrument: Instrument,
    hands: HandStaff[],
    onChange: (targets: Target[]) => void,
    fingers: () => FingerMap,
  ) {
    this.getCursor = getCursor
    this.instrument = instrument
    this.hands = hands
    this.onChange = onChange
    this.fingers = fingers
    this.skipToNextPress(false)
  }

  private get cursor(): Cursor {
    return this.getCursor()
  }

  get finished(): boolean {
    return this.cursor.iterator.EndReached
  }

  /** The notes to play now, with fingers, lowest first. */
  get targets(): Target[] {
    return this.finished ? [] : this.withFingers(this.required())
  }

  /** The score position the targets belong to. */
  get position(): string {
    return positionOf(this.cursor)
  }

  /** The measure the cursor is in (0-based), -1 at the end of the piece. */
  get measure(): number {
    return this.finished ? -1 : this.cursor.iterator.CurrentMeasureIndex
  }

  /** Move to the n-th cursor position of the piece (0 = the start), then on to the next note to play. */
  jumpToPosition(index: number): void {
    this.cursor.reset()
    for (let i = 0; i < index && !this.finished; i++) this.cursor.iterator.moveToNext()
    this.cursor.update()
    this.skipToNextPress(false)
  }

  /** Move to the start of a measure, then on to the next note to play. */
  jumpToMeasure(measure: number): void {
    this.moveToMeasureStart(measure)
    this.skipToNextPress(false)
  }

  /** Give up on the current notes and go to the next ones (the → key). */
  skip(): void {
    if (!this.finished) this.advance()
  }

  /** Repeat the measures start..end forever; null turns looping off. Turning it on jumps to the loop's start. */
  setLoop(loop: LoopRange | null): void {
    this.loop = loop
    if (loop) this.jumpToMeasure(loop.start)
    else this.refresh()
  }

  private moveToMeasureStart(measure: number): void {
    this.cursor.reset()
    while (!this.finished && this.cursor.iterator.CurrentMeasureIndex < measure) this.cursor.iterator.moveToNext()
    this.cursor.update()
  }

  /** Switch which hand(s) must play. Keeps the place in the piece and moves on if this hand has nothing to press here. */
  setHands(hands: HandStaff[]): void {
    this.hands = hands
    this.skipToNextPress(false)
  }

  /**
   * The drawn note heads (SVG elements) of the notes to play at the cursor, for colouring them in the score.
   * With a pitch, only the head of that note. OSMD gives every note of a chord the whole chord's heads,
   * so each note's head is the one at its rank among the chord's pitches.
   */
  noteheads(pitch?: number): HTMLElement[] {
    const drawn = this.cursor
      .GNotesUnderCursor(this.instrument)
      .filter((g) => !g.sourceNote.isRest()) as VexFlowGraphicalNote[]
    const chords = new Map<SVGGElement, VexFlowGraphicalNote[]>()
    for (const g of drawn) {
      const chord = g.getSVGGElement()
      chords.set(chord, [...(chords.get(chord) ?? []), g])
    }
    const heads: HTMLElement[] = []
    for (const notes of chords.values()) {
      notes.sort((a, b) => a.sourceNote.halfTone - b.sourceNote.halfTone)
      const all = notes[0].getNoteheadSVGs()
      if (all.length !== notes.length) continue // can't tell which head is which
      notes.forEach((g, i) => {
        const n = g.sourceNote
        const mine = this.hands.some((h) => h.staff === n.ParentStaffEntry.ParentStaff)
        if (mine && !isTiedContinuation(n) && (pitch === undefined || n.halfTone + 12 === pitch)) heads.push(all[i])
      })
    }
    return heads
  }

  /** Re-announce the targets, e.g. after the fingering changed. */
  refresh(): void {
    this.onChange(this.targets)
  }

  handle(event: MidiNoteEvent): void {
    if (event.type !== 'noteOn' || this.finished) return
    this.pressed.add(event.note)
    if (isSatisfied(this.required().map((t) => t.pitch), this.pressed)) this.advance()
  }

  private required(): Target[] {
    return requiredTargets(this.cursor, this.instrument, this.hands)
  }

  private withFingers(targets: Target[]): Target[] {
    const fingers = this.fingers()
    const position = this.position
    return targets.map((t) => ({ ...t, finger: fingers.get(fingerKey(t.hand, position, t.pitch)) ?? t.finger }))
  }

  private advance(): void {
    // Leaving the loop forwards (from inside it) wraps back to its start.
    const wasInLoop = this.loop !== null && this.measure >= this.loop.start && this.measure <= this.loop.end
    this.cursor.next()
    this.skipToNextPress(wasInLoop)
  }

  // Positions where this hand only rests or holds a tie have nothing to press.
  private skipToNextPress(wrapAllowed: boolean): void {
    this.pressed.clear()
    let wraps = 0
    for (;;) {
      if (wrapAllowed && this.loop && (this.finished || this.measure > this.loop.end)) {
        if (++wraps > 1) break // nothing playable in the loop for this hand: don't spin
        this.moveToMeasureStart(this.loop.start)
        continue
      }
      if (this.finished || this.required().length > 0) break
      this.cursor.next()
    }
    this.refresh()
  }
}
