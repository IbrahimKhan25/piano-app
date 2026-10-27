// Colours note heads in the drawn score for a moment, then fades them back to black.

const timers = new Map<HTMLElement, number>()

export const SCORE_GREEN = '#1f9d3f'
export const SCORE_RED = '#e5484d'

/** How long a coloured note head stays coloured before it fades back. */
export const SCORE_FLASH_MS = 500

/** Colour these note heads (SVG elements from OSMD) and restore them after `holdMs`. */
export function flashNoteheads(heads: HTMLElement[], color: string, holdMs: number = SCORE_FLASH_MS): void {
  for (const head of heads) {
    // A head is a group of paths; colour the group and everything inside it.
    const parts: HTMLElement[] = [head, ...Array.from(head.querySelectorAll<HTMLElement>('*'))]
    for (const part of parts) {
      part.style.transition = 'fill 0.25s, stroke 0.25s'
      part.style.fill = color
      const stroke = part.getAttribute('stroke')
      if (stroke && stroke !== 'none') part.style.stroke = color
    }
    window.clearTimeout(timers.get(head))
    timers.set(
      head,
      window.setTimeout(() => {
        for (const part of parts) {
          part.style.fill = ''
          part.style.stroke = ''
        }
        timers.delete(head)
      }, holdMs),
    )
  }
}
