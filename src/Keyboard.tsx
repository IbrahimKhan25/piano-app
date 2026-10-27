import { layoutKeys, type KeyRect } from './keyboardLayout'
import type { Target } from './waitMode'

/** How a held (or just released) key was judged when it was pressed. `id` changes with every press. */
export type KeyFeedback = { state: 'correct' | 'wrong'; id: number }

type Props = {
  lowest: number
  highest: number
  /** Keys the player should press now, with an optional finger number. */
  targets: Target[]
  /** Keys held down (or released a moment ago), and whether each was a right or wrong note when pressed. */
  pressed: ReadonlyMap<number, KeyFeedback>
}

const WHITE_HEIGHT = 4 // shorter than a real key so the score gets most of the screen
const BLACK_HEIGHT = 2.4

const COLORS = {
  white: '#ffffff',
  black: '#222222',
  target: '#6ea8ff', // right hand
  targetLeft: '#ffb066', // left hand
  correct: '#4cc764',
  wrong: '#e5484d',
  stroke: '#333333',
}

export default function Keyboard({ lowest, highest, targets, pressed }: Props) {
  const { whites, blacks, whiteCount } = layoutKeys(lowest, highest)
  const targetByPitch = new Map(targets.map((t) => [t.pitch, t]))

  function fill(key: KeyRect, base: string): string {
    const target = targetByPitch.get(key.pitch)
    const feedback = pressed.get(key.pitch)
    if (feedback) return feedback.state === 'correct' ? COLORS.correct : COLORS.wrong
    if (!target) return base
    return target.hand === 'left' ? COLORS.targetLeft : COLORS.target
  }

  // A wrong key shakes; two animation names alternate so each new wrong press restarts the shake.
  function shakeClass(key: KeyRect): string | undefined {
    const feedback = pressed.get(key.pitch)
    return feedback?.state === 'wrong' ? (feedback.id % 2 === 0 ? 'key-shake-a' : 'key-shake-b') : undefined
  }

  function finger(key: KeyRect, y: number, color: string) {
    const f = targetByPitch.get(key.pitch)?.finger
    if (f === undefined) return null
    return (
      <text
        x={key.x + key.width / 2}
        y={y}
        textAnchor="middle"
        fontSize={0.5}
        fontWeight="bold"
        fill={color}
      >
        {f}
      </text>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${whiteCount} ${WHITE_HEIGHT}`}
      style={{ width: '100%', maxWidth: whiteCount * 60, display: 'block' }}
      role="img"
      aria-label="Piano keyboard"
    >
      {whites.map((k) => (
        <g key={k.pitch} className={shakeClass(k)}>
          <rect
            data-pitch={k.pitch}
            x={k.x}
            y={0}
            width={k.width}
            height={WHITE_HEIGHT}
            fill={fill(k, COLORS.white)}
            stroke={COLORS.stroke}
            strokeWidth={0.03}
            style={{ transition: 'fill 0.25s' }}
          />
          {finger(k, WHITE_HEIGHT - 0.4, '#102a5c')}
        </g>
      ))}
      {blacks.map((k) => (
        <g key={k.pitch} className={shakeClass(k)}>
          <rect
            data-pitch={k.pitch}
            x={k.x}
            y={0}
            width={k.width}
            height={BLACK_HEIGHT}
            fill={fill(k, COLORS.black)}
            stroke={COLORS.stroke}
            strokeWidth={0.03}
            style={{ transition: 'fill 0.25s' }}
          />
          {finger(k, BLACK_HEIGHT - 0.35, '#ffffff')}
        </g>
      ))}
    </svg>
  )
}
