import type { ReactNode } from 'react'
import type { ControllerFamily } from '@/types'
import type { PartType } from '@/iot/types'

/** Pictures of the real parts, drawn in SVG (Wokwi-style: you recognise the module, not a rectangle). Origin is the top-left of the art area. */
export type ArtKind = PartType | ControllerFamily | 'psu' | 'mosfet'

export interface ArtState {
  /** outputs: commanded duty 0…1 */
  duty?: number
  /** animate (simulation running) */
  running?: boolean
  /** sensors: text shown on the part */
  reading?: string
  /** which kind of value this is: simulated / set by you / hardware / commanded / acknowledged */
  note?: string
}

export const ART_H: Record<ArtKind, number> = {
  esp32: 96, uno: 96, rpi: 96, dht22: 62, ds18b20: 56, bme280: 56, bh1750: 56, ldr: 56, pir: 62, led: 58, dcMotor: 76, pca9685: 60, tca9548a: 56, ads1115: 56, psu: 52, mosfet: 56,
}

const Pins = ({ n, x, y, gap = 7 }: { n: number; x: number; y: number; gap?: number }) => (
  <g>{Array.from({ length: n }, (_, i) => <rect key={i} x={x + i * gap} y={y} width={3} height={8} fill="#d4a72c" />)}</g>
)
const Label = ({ x, y, children, size = 9, fill = '#fff', anchor = 'middle' }: { x: number; y: number; children: ReactNode; size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end' }) => (
  <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontFamily="ui-sans-serif,system-ui" fontWeight={600}>{children}</text>
)

export function Art({ kind, w, st }: { kind: ArtKind; w: number; st: ArtState }): ReactNode {
  const cx = w / 2
  const duty = Math.max(0, Math.min(1, st.duty ?? 0))
  const read = st.reading ? <Label x={cx} y={ART_H[kind] - 3} size={10} fill="#0f172a">{st.reading}</Label> : null
  switch (kind) {
    case 'esp32':
      return (
        <g>
          <rect x={cx - 60} y={6} width={120} height={84} rx={5} fill="#1f2937" stroke="#0b1220" />
          <rect x={cx - 38} y={14} width={50} height={40} rx={2} fill="#cbd5e1" stroke="#94a3b8" />
          <Label x={cx - 13} y={38} fill="#334155" size={10}>ESP32</Label>
          <path d={`M${cx + 20},20 h30 v8 h-26 v8 h26 v8 h-26`} fill="none" stroke="#d4a72c" strokeWidth={2} />
          <rect x={cx - 14} y={76} width={28} height={14} rx={2} fill="#9ca3af" />
          <circle cx={cx + 44} cy={72} r={3} fill="#22c55e" />
          <Pins n={14} x={cx - 50} y={4} />
          <Pins n={14} x={cx - 50} y={84} />
        </g>
      )
    case 'uno':
      return (
        <g>
          <rect x={cx - 66} y={6} width={132} height={84} rx={5} fill="#0e7490" stroke="#164e63" />
          <rect x={cx - 74} y={16} width={26} height={24} fill="#9ca3af" stroke="#6b7280" />
          <rect x={cx - 74} y={56} width={24} height={24} fill="#111827" />
          <rect x={cx - 20} y={34} width={50} height={20} rx={2} fill="#111827" />
          <Label x={cx + 5} y={48} size={8}>ATmega328P</Label>
          <Label x={cx + 30} y={78} size={13}>UNO</Label>
          <Pins n={14} x={cx - 40} y={6} />
          <Pins n={6} x={cx - 10} y={82} />
        </g>
      )
    case 'rpi':
      return (
        <g>
          <rect x={cx - 66} y={6} width={132} height={84} rx={5} fill="#15803d" stroke="#14532d" />
          <rect x={cx - 24} y={30} width={34} height={34} fill="#1f2937" />
          <rect x={cx + 20} y={20} width={36} height={22} fill="#9ca3af" />
          <rect x={cx + 20} y={50} width={36} height={22} fill="#9ca3af" />
          <rect x={cx - 60} y={8} width={120} height={12} fill="#111827" />
          <Pins n={20} x={cx - 56} y={10} gap={5.5} />
          <Label x={cx - 8} y={82} size={9}>Raspberry Pi</Label>
        </g>
      )
    case 'dht22':
      return (
        <g>
          <rect x={cx - 20} y={4} width={40} height={42} rx={3} fill="#e5e7eb" stroke="#9ca3af" />
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={cx - 14 + i * 7} y={9} width={3} height={22} fill="#6b7280" />)}
          <Label x={cx} y={41} size={7.5} fill="#334155">DHT22</Label>
          <Pins n={3} x={cx - 7} y={46} gap={7} />
          {st.reading && <Label x={cx + 34} y={26} size={10} fill="#0f172a" anchor="start">{st.reading}</Label>}
        </g>
      )
    case 'ds18b20':
      return (
        <g>
          <path d={`M${cx - 12},8 a12,12 0 0 1 24,0 v22 h-24 z`} fill="#111827" />
          <Label x={cx} y={26} size={6.5}>DS18B20</Label>
          <rect x={cx - 9} y={30} width={2} height={18} fill="#cbd5e1" /><rect x={cx - 1} y={30} width={2} height={18} fill="#cbd5e1" /><rect x={cx + 7} y={30} width={2} height={18} fill="#cbd5e1" />
          {st.reading && <Label x={cx + 24} y={22} size={10} fill="#0f172a" anchor="start">{st.reading}</Label>}
        </g>
      )
    case 'bme280':
      return (
        <g>
          <rect x={cx - 24} y={6} width={48} height={36} rx={3} fill="#7c3aed" stroke="#5b21b6" />
          <rect x={cx - 8} y={12} width={16} height={14} rx={1} fill="#cbd5e1" />
          <Label x={cx} y={37} size={7.5}>BME280</Label>
          <Pins n={4} x={cx - 11} y={42} />
          {st.reading && <Label x={cx + 30} y={24} size={10} fill="#0f172a" anchor="start">{st.reading}</Label>}
        </g>
      )
    case 'bh1750':
      return (
        <g>
          <rect x={cx - 24} y={6} width={48} height={36} rx={3} fill="#2563eb" stroke="#1e40af" />
          <rect x={cx - 9} y={12} width={18} height={10} rx={1} fill="#111827" />
          <circle cx={cx + 16} cy={14} r={3} fill="#fde68a" />
          <Label x={cx} y={37} size={7.5}>BH1750</Label>
          <Pins n={4} x={cx - 11} y={42} />
          {st.reading && <Label x={cx + 30} y={24} size={10} fill="#0f172a" anchor="start">{st.reading}</Label>}
        </g>
      )
    case 'ldr':
      return (
        <g>
          <circle cx={cx} cy={22} r={16} fill="#d6b27a" stroke="#92400e" />
          <path d={`M${cx - 11},16 h22 M${cx - 11},22 h22 M${cx - 11},28 h22`} stroke="#7c2d12" strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <rect x={cx - 6} y={38} width={2} height={14} fill="#cbd5e1" /><rect x={cx + 4} y={38} width={2} height={14} fill="#cbd5e1" />
          {st.reading && <Label x={cx + 22} y={26} size={10} fill="#0f172a" anchor="start">{st.reading}</Label>}
        </g>
      )
    case 'pir':
      return (
        <g>
          <rect x={cx - 26} y={14} width={52} height={36} rx={3} fill="#16a34a" stroke="#166534" />
          <circle cx={cx} cy={24} r={15} fill="#f8fafc" stroke="#cbd5e1" />
          <Label x={cx} y={58} size={8} fill="#334155">PIR HC-SR501</Label>
        </g>
      )
    case 'led': {
      const glow = 0.15 + 0.85 * duty
      const body = duty > 0.02 ? '#fde047' : '#a16207'
      return (
        <g>
          {duty > 0.02 && <circle cx={cx - 40} cy={22} r={10 + duty * 14} fill="#fde047" opacity={0.35 * glow} />}
          <path d={`M${cx - 48},30 v-12 a8,8 0 0 1 16,0 v12 z`} fill={body} stroke="#854d0e" opacity={duty > 0.02 ? glow + 0.15 : 0.9} data-testid="led-body" data-duty={duty.toFixed(2)} />
          <rect x={cx - 44} y={30} width={2} height={14} fill="#cbd5e1" /><rect x={cx - 38} y={30} width={2} height={14} fill="#cbd5e1" />
          <rect x={cx - 10} y={20} width={46} height={12} rx={3} fill="#d6b88a" stroke="#92400e" />
          {[4, 12, 22, 30].map((o, i) => <rect key={i} x={cx - 10 + o + 2} y={20} width={3} height={12} fill={['#ef4444', '#a855f7', '#92400e', '#d4a72c'][i]} />)}
          <Label x={cx + 13} y={46} size={8} fill="#334155">resistor</Label>
          <Label x={cx} y={ART_H.led - 2} size={9} fill="#0f172a">{Math.round(duty * 100)}%</Label>
        </g>
      )
    }
    case 'dcMotor': {
      const rps = duty > 0.02 ? 0.5 + duty * 5 : 0
      return (
        <g>
          {/* motor can + shaft + blades */}
          <rect x={cx - 64} y={22} width={40} height={28} rx={5} fill="#9ca3af" stroke="#4b5563" />
          <rect x={cx - 24} y={33} width={10} height={6} fill="#6b7280" />
          <g transform={`translate(${cx + 4} 36)`}>
            <g className={rps ? 'ss-spin' : ''} style={rps ? { animationDuration: `${(1 / rps).toFixed(2)}s`, animationPlayState: st.running === false ? 'paused' : 'running' } : undefined} data-testid="motor-rotor" data-duty={duty.toFixed(2)}>
              {[0, 90, 180, 270].map((a) => <ellipse key={a} cx={0} cy={-11} rx={5} ry={11} fill="#60a5fa" stroke="#1d4ed8" strokeWidth={0.8} transform={`rotate(${a})`} />)}
              <circle r={3.5} fill="#1f2937" />
            </g>
          </g>
          <Label x={cx - 8} y={70} size={8.5} fill="#0f172a">{Math.round(duty * 100)}%{rps ? '' : ' (off)'}</Label>
        </g>
      )
    }
    case 'pca9685':
    case 'ads1115':
    case 'tca9548a':
      return (
        <g>
          <rect x={cx - 40} y={6} width={80} height={40} rx={3} fill={kind === 'pca9685' ? '#2563eb' : kind === 'ads1115' ? '#7c3aed' : '#0891b2'} stroke="#1e293b" />
          <rect x={cx - 14} y={14} width={28} height={12} fill="#111827" />
          <Label x={cx} y={38} size={8}>{kind.toUpperCase()}</Label>
          <Pins n={8} x={cx - 28} y={46} />
        </g>
      )
    case 'mosfet':
      return (
        <g>
          <rect x={cx - 52} y={6} width={104} height={44} rx={4} fill="#0f766e" stroke="#115e59" />
          <rect x={cx - 14} y={13} width={28} height={16} rx={1} fill="#111827" />
          <rect x={cx - 11} y={29} width={4} height={8} fill="#cbd5e1" /><rect x={cx - 2} y={29} width={4} height={8} fill="#cbd5e1" /><rect x={cx + 7} y={29} width={4} height={8} fill="#cbd5e1" />
          <Label x={cx} y={24} size={7}>N-MOSFET</Label>
          <rect x={cx + 24} y={14} width={20} height={7} rx={2} fill="#1f2937" /><rect x={cx + 24} y={14} width={5} height={7} fill="#d1d5db" />
          <Label x={cx + 34} y={31} size={6.5}>1N5819</Label>
          <Label x={cx - 36} y={44} size={6.5}>100Ω</Label><Label x={cx + 2} y={46} size={6.5}>10k pull-down</Label>
        </g>
      )
    case 'psu':
      return (
        <g>
          <rect x={cx - 30} y={8} width={60} height={34} rx={4} fill="#374151" stroke="#111827" />
          <Label x={cx} y={30} size={10}>DC supply</Label>
        </g>
      )
  }
  return read
}
