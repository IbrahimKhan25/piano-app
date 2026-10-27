// Fingers the player has set by hand, saved per song in localStorage.
// Keys are fingerKey(hand, position, pitch), so they follow the note, not the screen layout.

export type Corrections = Map<string, number>

type SavedFile = { version: 1; song: string; fingers: Record<string, number> }

const storageKey = (song: string) => `piano-app:fingers:${song}`

function isFinger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

/** Parses a saved/exported file, ignoring anything that isn't a valid finger. */
export function parseCorrections(text: string): Corrections {
  const data: unknown = JSON.parse(text)
  const fingers = (data as Partial<SavedFile> | null)?.fingers
  const result: Corrections = new Map()
  if (fingers && typeof fingers === 'object') {
    for (const [key, finger] of Object.entries(fingers)) {
      // Older saves had no hand in the key; those fingers were all for the right hand.
      if (isFinger(finger)) result.set(/^[LR]:/.test(key) ? key : `R:${key}`, finger)
    }
  }
  return result
}

export function serializeCorrections(song: string, corrections: Corrections): string {
  const file: SavedFile = { version: 1, song, fingers: Object.fromEntries(corrections) }
  return JSON.stringify(file, null, 2)
}

// localStorage can be missing or throw (private windows, blocked storage); the app still works without it.
export function loadCorrections(song: string): Corrections {
  try {
    const text = localStorage.getItem(storageKey(song))
    return text ? parseCorrections(text) : new Map()
  } catch {
    return new Map()
  }
}

export function saveCorrections(song: string, corrections: Corrections): void {
  try {
    localStorage.setItem(storageKey(song), serializeCorrections(song, corrections))
  } catch {
    // Not saved; the corrections still apply for this session.
  }
}
