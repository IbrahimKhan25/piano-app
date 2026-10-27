import { useEffect, useRef } from 'react'
import type { MidiNoteEvent } from './midi'

// DAW-style layout: the home row is the white keys, the row above is the black keys.
const KEY_TO_SEMITONE: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13,
  KeyL: 14, KeyP: 15, Semicolon: 16,
}

/** Dev stand-in for a piano: A..; play from middle C, Z/X shift one octave down/up. Emits the same events as real MIDI. */
export function useKeyboardPiano(onNote: (event: MidiNoteEvent) => void, enabled: boolean) {
  const onNoteRef = useRef(onNote)
  useEffect(() => {
    onNoteRef.current = onNote
  })

  useEffect(() => {
    if (!enabled) return
    let octaveShift = 0
    const sounding = new Map<string, number>() // key code -> note, so release matches the press

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'KeyZ') octaveShift -= 1
      else if (e.code === 'KeyX') octaveShift += 1
      else if (e.code in KEY_TO_SEMITONE && !sounding.has(e.code)) {
        const note = 60 + 12 * octaveShift + KEY_TO_SEMITONE[e.code]
        sounding.set(e.code, note)
        onNoteRef.current({ type: 'noteOn', note, velocity: 80, channel: 0 })
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const note = sounding.get(e.code)
      if (note === undefined) return
      sounding.delete(e.code)
      onNoteRef.current({ type: 'noteOff', note, velocity: 0, channel: 0 })
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [enabled])
}
