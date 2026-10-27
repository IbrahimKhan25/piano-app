import type { MidiStatus } from './midi'

const STATUS_TEXT = {
  pending: 'Waiting for MIDI permission…',
  unsupported: 'Web MIDI is not supported in this browser (use desktop Chrome).',
  denied: 'MIDI access was denied. Allow it in the site settings and reload.',
  ready: 'MIDI ready',
} as const

type Props = {
  status: MidiStatus
  devices: string[]
  lines: string[]
}

export default function MidiLog({ status, devices, lines }: Props) {
  return (
    <section style={{ fontFamily: 'monospace', fontSize: 14, margin: '8px 0' }}>
      <div>
        {STATUS_TEXT[status]}
        {status === 'ready' &&
          (devices.length > 0 ? ` — ${devices.join(', ')}` : ' — no input devices found')}
      </div>
      <pre style={{ margin: '4px 0', minHeight: '10em' }}>{lines.join('\n')}</pre>
    </section>
  )
}
