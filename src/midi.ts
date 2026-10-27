// Plain TypeScript, no React: only connectMidi touches the browser's Web MIDI API.

export type MidiNoteEvent = {
  type: 'noteOn' | 'noteOff'
  /** MIDI note number, 60 = middle C (C4) */
  note: number
  /** 0-127, how hard the key was pressed */
  velocity: number
  /** 0-15 */
  channel: number
}

export type MidiStatus = 'pending' | 'unsupported' | 'denied' | 'ready'

/**
 * A MIDI message is 1-3 raw bytes. For notes: [status, note, velocity].
 * The high 4 bits of status are the message type (0x9 note-on, 0x8 note-off),
 * the low 4 bits are the channel. Anything that isn't a note returns null.
 */
export function parseMidiMessage(data: ArrayLike<number>): MidiNoteEvent | null {
  if (data.length < 3) return null
  const kind = data[0] >> 4
  const channel = data[0] & 0x0f
  const note = data[1]
  const velocity = data[2]

  if (kind === 0x9) {
    // Many pianos send note-off as note-on with velocity 0.
    return { type: velocity > 0 ? 'noteOn' : 'noteOff', note, velocity, channel }
  }
  if (kind === 0x8) return { type: 'noteOff', note, velocity, channel }
  return null
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 60 -> "C4" */
export function noteName(note: number): string {
  return NAMES[note % 12] + (Math.floor(note / 12) - 1)
}

/** "noteOn 60 (C4) vel 72 ch 1" */
export function formatMidiEvent(e: MidiNoteEvent): string {
  return `${e.type} ${e.note} (${noteName(e.note)}) vel ${e.velocity} ch ${e.channel + 1}`
}

type ConnectOptions = {
  onNote: (event: MidiNoteEvent) => void
  onStatus: (status: MidiStatus) => void
  onDevices: (names: string[]) => void
}

/** Listens on every MIDI input, including ones plugged in later. Returns a cleanup function. */
export function connectMidi({ onNote, onStatus, onDevices }: ConnectOptions): () => void {
  if (!navigator.requestMIDIAccess) {
    onStatus('unsupported')
    return () => {}
  }

  let cancelled = false
  let access: MIDIAccess | null = null

  function handleMessage(e: MIDIMessageEvent) {
    if (!e.data) return
    const event = parseMidiMessage(e.data)
    if (event) onNote(event)
  }

  // Runs on connect and again whenever a device is plugged in or removed.
  function attachInputs() {
    if (!access) return
    const names: string[] = []
    access.inputs.forEach((input) => {
      input.onmidimessage = handleMessage
      names.push(input.name ?? input.id)
    })
    onDevices(names)
  }

  navigator
    .requestMIDIAccess() // no sysex: we only need notes
    .then((a) => {
      if (cancelled) return
      access = a
      a.onstatechange = attachInputs
      attachInputs()
      onStatus('ready')
    })
    .catch(() => {
      if (!cancelled) onStatus('denied')
    })

  return () => {
    cancelled = true
    if (access) {
      access.onstatechange = null
      access.inputs.forEach((input) => {
        input.onmidimessage = null
      })
    }
  }
}
