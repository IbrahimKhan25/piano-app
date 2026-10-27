import { useEffect, useRef, useState } from 'react'
import { connectMidi, type MidiNoteEvent, type MidiStatus } from './midi'

/**
 * Connects to MIDI inputs and calls onNote for every note-on/off.
 * Notes go through a callback, not React state, so fast chords don't
 * trigger a re-render per key. Only status and device names are state.
 */
export function useMidi(onNote: (event: MidiNoteEvent) => void) {
  const [status, setStatus] = useState<MidiStatus>('pending')
  const [devices, setDevices] = useState<string[]>([])

  // Keep the latest callback in a ref so we don't reconnect MIDI when it changes.
  const onNoteRef = useRef(onNote)
  useEffect(() => {
    onNoteRef.current = onNote
  })

  useEffect(
    () =>
      connectMidi({
        onNote: (event) => onNoteRef.current(event),
        onStatus: setStatus,
        onDevices: setDevices,
      }),
    [],
  )

  return { status, devices }
}
