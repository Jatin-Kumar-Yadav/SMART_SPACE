import { useMemo, useRef } from 'react'
import { allSeatSlots } from '@/simulation/occupancy'
import { CATALOG } from '@/objects/catalog'
import { useEditor } from '@/store/editorStore'

export interface PlanMark {
  x: number
  z: number
  label: string
  active?: boolean
}

/**
 * Top-down plan of the room used to say WHERE a clicked image point is in the room.
 * Clicks snap to room corners and seat centres when they are close, because those are the points
 * a person can also recognise in the photo.
 */
export function FloorPlanPicker({ marks, onPick }: { marks: PlanMark[]; onPick: (x: number, z: number) => void }) {
  const space = useEditor((s) => s.space!)
  const ref = useRef<SVGSVGElement>(null)
  const { length: L, width: W } = space.dims
  const pad = Math.max(L, W) * 0.05
  const seats = useMemo(() => allSeatSlots(space.objects), [space.objects])
  const snaps = useMemo(() => [[0, 0], [L, 0], [L, W], [0, W]] as [number, number][], [L, W])
  const r = Math.max(L, W) / 90

  const pick = (e: React.PointerEvent) => {
    const svg = ref.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbW = L + 2 * pad
    const vbH = W + 2 * pad
    const x = ((e.clientX - rect.left) / rect.width) * vbW - pad
    const z = ((e.clientY - rect.top) / rect.height) * vbH - pad
    const tol = Math.max(L, W) * 0.04
    let best: [number, number] | null = null
    let bd = tol
    for (const p of [...snaps, ...seats.map((s) => [s.position[0], s.position[2]] as [number, number])]) {
      const d = Math.hypot(p[0] - x, p[1] - z)
      if (d < bd) { bd = d; best = p }
    }
    const [px, pz] = best ?? [x, z]
    onPick(Math.round(Math.max(0, Math.min(L, px)) * 100) / 100, Math.round(Math.max(0, Math.min(W, pz)) * 100) / 100)
  }

  return (
    <svg ref={ref} viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`} className="w-full cursor-crosshair rounded-md border border-slate-200 bg-slate-50" onPointerDown={pick} role="img" aria-label="Room plan: click to choose the room position of the selected point">
      <rect x={0} y={0} width={L} height={W} fill="#fff" stroke="#334155" strokeWidth={r * 0.8} />
      {space.objects.filter((o) => o.visible && CATALOG[o.kind].category !== 'device' && !CATALOG[o.kind].wallMounted).map((o) => (
        <rect key={o.id} x={-o.dims[0] / 2} y={-o.dims[2] / 2} width={o.dims[0]} height={o.dims[2]} transform={`translate(${o.position[0]} ${o.position[2]}) rotate(${(-o.rotationY * 180) / Math.PI})`} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={r * 0.25} />
      ))}
      {seats.map((s) => <circle key={s.key} cx={s.position[0]} cy={s.position[2]} r={r * 0.7} fill="#93c5fd" />)}
      {snaps.map(([x, z], i) => <rect key={i} x={x - r} y={z - r} width={2 * r} height={2 * r} fill="#0f172a" />)}
      {marks.map((m, i) => (
        <g key={i}>
          <circle cx={m.x} cy={m.z} r={r * (m.active ? 2.1 : 1.6)} fill={m.active ? '#2563eb' : '#f59e0b'} stroke="#fff" strokeWidth={r * 0.35} />
          <text x={m.x} y={m.z + r * 0.75} textAnchor="middle" fontSize={r * 2} fontWeight={700} fill="#fff">{m.label}</text>
        </g>
      ))}
    </svg>
  )
}
