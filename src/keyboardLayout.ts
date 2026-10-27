// Pure geometry for the on-screen piano. Units: one white key is 1 wide.

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11])

export const BLACK_KEY_WIDTH = 0.6

export type KeyRect = {
  pitch: number
  x: number
  width: number
}

export type KeyboardLayout = {
  whites: KeyRect[]
  blacks: KeyRect[]
  whiteCount: number
}

export function isBlackKey(pitch: number): boolean {
  return !WHITE_PITCH_CLASSES.has(pitch % 12)
}

/** Widen a note range to whole octaves: from the C at or below `low` up to the B at or above `high`. */
export function paddedRange(low: number, high: number): { lowest: number; highest: number } {
  return { lowest: low - (low % 12), highest: high - (high % 12) + 11 }
}

/** Key rectangles for lowest..highest. Both ends should be white keys (paddedRange guarantees it). */
export function layoutKeys(lowest: number, highest: number): KeyboardLayout {
  const whites: KeyRect[] = []
  const blacks: KeyRect[] = []

  for (let pitch = lowest; pitch <= highest; pitch++) {
    if (isBlackKey(pitch)) {
      // A black key straddles the boundary after the white key just below it.
      const lowerWhite = whites[whites.length - 1]
      if (!lowerWhite) continue
      blacks.push({ pitch, x: lowerWhite.x + 1 - BLACK_KEY_WIDTH / 2, width: BLACK_KEY_WIDTH })
    } else {
      whites.push({ pitch, x: whites.length, width: 1 })
    }
  }
  return { whites, blacks, whiteCount: whites.length }
}
