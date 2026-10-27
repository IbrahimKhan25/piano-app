// Right-hand fingering by dynamic programming (Viterbi). Pure: no React, no OSMD.
//
// Each note event is a layer; each assignment of fingers 1-5 to its notes is a
// state. A path's cost is the sum of per-state costs (black keys, weak fingers,
// chord stretch) and transition costs (stretch, crossing, hand moves). The
// cheapest path through all layers is the suggested fingering.
// Loosely based on the ergonomic rules of Parncutt et al. (1997), simplified.

/** One right-hand cursor position that needs a key press. */
export type NoteEvent = {
  /** Stable position in the score (see positionOf in waitMode.ts) */
  position: string
  /** MIDI pitches, ascending */
  pitches: number[]
  /** Fingers already known for each pitch (from the file or the player), else undefined */
  fixed: (number | undefined)[]
}

export type FingerMap = Map<string, number>

export type Hand = 'right' | 'left'

/** Key of one note's finger: which hand, where in the score, and which pitch. */
export function fingerKey(hand: Hand, position: string, pitch: number): string {
  return `${hand === 'left' ? 'L' : 'R'}:${position}:${pitch}`
}

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

// Semitone spans between two fingers: comfortable, and the practical maximum.
const COMFORT: Record<string, number> = {
  '1-2': 5, '1-3': 7, '1-4': 9, '1-5': 10, '2-3': 3, '2-4': 5, '2-5': 7, '3-4': 2, '3-5': 4, '4-5': 2,
}
const PRACTICAL: Record<string, number> = {
  '1-2': 8, '1-3': 10, '1-4': 12, '1-5': 13, '2-3': 5, '2-4': 7, '2-5': 9, '3-4': 4, '3-5': 6, '4-5': 3,
}

// Moving the whole hand costs about the same whichever fingers are used.
const REPOSITION_BASE = 3.5
const REPOSITION_PER_SEMITONE = 0.1

/** Cost of spreading the hand from the lower finger `a` to the higher finger `b` over `span` semitones. */
function stretchCost(a: number, b: number, span: number): number {
  const key = `${a}-${b}`
  let cost = Math.max(0, span - COMFORT[key])
  if (span > PRACTICAL[key]) cost += 6 * (span - PRACTICAL[key])
  const fingerGap = b - a
  // Fingers that are not neighbours need room: squeezing 2 and 5 into a third is awkward.
  if (fingerGap >= 2) cost += 0.4 * Math.max(0, 1.5 * fingerGap - span)
  return cost
}

// Passing the thumb under (going up) or a finger over the thumb (going down).
function crossingCost(thumbSide: number, otherFinger: number): number {
  if (thumbSide !== 1) return 12 // crossing without the thumb is unnatural here
  if (otherFinger === 3 || otherFinger === 4) return 1
  if (otherFinger === 2) return 2.5
  return 8
}

/** Cost of playing pitch p2 with finger f2 right after pitch p1 with finger f1. */
export function transitionCost(f1: number, p1: number, f2: number, p2: number): number {
  const d = p2 - p1
  let cost: number
  if (d === 0) {
    cost = f1 === f2 ? 0 : 1.5
  } else if (f1 === f2) {
    cost = 4 + 0.2 * Math.abs(d) // same finger, different key: the hand must jump
  } else if (f2 > f1 === d > 0) {
    cost = stretchCost(Math.min(f1, f2), Math.max(f1, f2), Math.abs(d)) // fingers follow the pitch direction
  } else if (d > 0) {
    cost = crossingCost(f2, f1) // up the keyboard with falling finger numbers: thumb under
  } else {
    cost = crossingCost(f1, f2) // down the keyboard with rising finger numbers: finger over thumb
  }
  return Math.min(cost, REPOSITION_BASE + REPOSITION_PER_SEMITONE * Math.abs(d))
}

/** Cost of one note's finger on its own: black keys and weak fingers. */
function singleNoteCost(finger: number, pitch: number): number {
  let cost = 0
  if (BLACK_PITCH_CLASSES.has(pitch % 12)) {
    if (finger === 1) cost += 1
    if (finger === 5) cost += 0.5
  }
  if (finger === 4) cost += 0.3
  return cost
}

// `pitches` are in finger order (see suggestFingering); `real` are the actual MIDI pitches in the same order.
function stateCost(pitches: number[], real: number[], fingers: number[]): number {
  let cost = 0
  for (let i = 0; i < pitches.length; i++) {
    cost += singleNoteCost(fingers[i], real[i])
    // Chord notes are played together: the hand has to span adjacent notes.
    if (i > 0) cost += stretchCost(fingers[i - 1], fingers[i], pitches[i] - pitches[i - 1])
  }
  // Prefer an open hand for chords (1-3-5 over 1-2-3) when nothing else decides.
  if (pitches.length > 1) cost += 0.1 * (4 - (fingers[fingers.length - 1] - fingers[0]))
  return cost
}

function betweenStates(prevPitches: number[], prev: number[], pitches: number[], next: number[]): number {
  let total = 0
  for (let i = 0; i < prev.length; i++) {
    for (let j = 0; j < next.length; j++) {
      total += transitionCost(prev[i], prevPitches[i], next[j], pitches[j])
    }
  }
  return total / (prev.length * next.length)
}

// All ways to give `count` notes distinct, ascending fingers from 1-5.
const combinationCache = new Map<number, number[][]>()
function fingerCombinations(count: number): number[][] {
  const cached = combinationCache.get(count)
  if (cached) return cached
  const result: number[][] = []
  const build = (start: number, current: number[]) => {
    if (current.length === count) {
      result.push(current)
      return
    }
    for (let f = start; f <= 5; f++) build(f + 1, [...current, f])
  }
  build(1, [])
  combinationCache.set(count, result)
  return result
}

/**
 * Suggests a finger for every note of one hand. Events with fingers already given (`fixed`)
 * keep them, and the rest is routed around them. Events with more than five
 * notes can't be played by one hand and only keep their fixed fingers.
 *
 * The right hand puts finger 1 on the lowest note of a position; the left hand puts it on the
 * highest. We run the same search for both by mirroring the left hand's pitches (negating them),
 * which turns it into a right hand, while the black-key rule keeps using the real pitches.
 */
export function suggestFingering(events: NoteEvent[], hand: Hand = 'right'): FingerMap {
  const mirror = hand === 'left'
  // Per event, the notes in finger order: ascending for the right hand, from the top down for the left.
  const views = events
    .filter((e) => e.pitches.length >= 1 && e.pitches.length <= 5)
    .map((e) => ({
      position: e.position,
      real: mirror ? [...e.pitches].reverse() : e.pitches,
      calc: mirror ? e.pitches.map((p) => -p).reverse() : e.pitches,
      fixed: mirror ? [...e.fixed].reverse() : e.fixed,
    }))

  // States per layer: only those that honour the fixed fingers (all, if the fixed ones conflict).
  const layers = views.map((v) => {
    const all = fingerCombinations(v.calc.length)
    const matching = all.filter((state) => state.every((f, i) => v.fixed[i] === undefined || v.fixed[i] === f))
    return matching.length > 0 ? matching : all
  })

  const cost: number[][] = []
  const back: number[][] = []
  for (let i = 0; i < views.length; i++) {
    cost.push([])
    back.push([])
    for (const state of layers[i]) {
      const own = stateCost(views[i].calc, views[i].real, state)
      if (i === 0) {
        cost[i].push(own)
        back[i].push(-1)
        continue
      }
      let best = Infinity
      let bestPrev = 0
      layers[i - 1].forEach((prev, p) => {
        const total = cost[i - 1][p] + betweenStates(views[i - 1].calc, prev, views[i].calc, state)
        if (total < best) {
          best = total
          bestPrev = p
        }
      })
      cost[i].push(own + best)
      back[i].push(bestPrev)
    }
  }

  const result: FingerMap = new Map()
  if (views.length > 0) {
    // Trace the cheapest path back from the last layer.
    const last = views.length - 1
    let index = cost[last].indexOf(Math.min(...cost[last]))
    for (let i = last; i >= 0; i--) {
      layers[i][index].forEach((finger, j) => result.set(fingerKey(hand, views[i].position, views[i].real[j]), finger))
      index = back[i][index]
    }
  }

  // Fixed fingers always win, even for events the search skipped.
  for (const e of events) {
    e.pitches.forEach((pitch, j) => {
      const fixed = e.fixed[j]
      if (fixed !== undefined) result.set(fingerKey(hand, e.position, pitch), fixed)
    })
  }
  return result
}
