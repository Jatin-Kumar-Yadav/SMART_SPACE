import { useEditor } from '@/store/editorStore'
import { useHover } from '@/store/hoverStore'
import { useSim } from '@/store/simStore'

/** Floating read-out for the floor cell under the pointer (temperature, light, occupancy, devices, coverage). */
export function HoverTooltip() {
  const hover = useHover((s) => s.floor)
  const snap = useSim((s) => s.snapshot)
  const objects = useEditor((s) => s.space!.objects)
  const layer = useEditor((s) => s.layer)
  if (!hover || !snap || layer === 'normal') return null
  const i = hover.cell
  if (i < 0 || i >= snap.temp.length) return null
  const zone = snap.zones.find((z) => z.id === snap.zoneIdByCell[i])
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? id
  const devs = zone ? [...zone.acIds, ...zone.fanIds, ...zone.lightIds].map(name) : []
  const here = snap.coverage.filter((c) => c.cell === i)
  const status = here.length ? (here.some((c) => c.status === 'uncovered') ? 'Underserved occupant' : here.every((c) => c.status === 'covered') ? 'Covered' : 'Partial') : zone?.coverage ?? '—'
  return (
    <div className="pointer-events-none fixed z-[150] w-56 rounded-lg border border-slate-200 bg-white/97 p-2 text-[11px] text-slate-700 shadow-lg" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
      <div className="mb-1 font-semibold text-slate-900">({hover.x.toFixed(1)} m, {hover.z.toFixed(1)} m){zone ? ` · Zone ${zone.id + 1}` : ''}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <span className="text-slate-500">Temperature</span><span>{snap.temp[i].toFixed(1)} °C <span className="text-slate-400">(feels {snap.perceived[i].toFixed(1)})</span></span>
        <span className="text-slate-500">Lighting</span><span>{Math.round(snap.lux[i])} lx <span className="text-slate-400">({Math.round(snap.natural[i])} day / {Math.round(snap.artificial[i])} lamp)</span></span>
        <span className="text-slate-500">Occupancy</span><span>{snap.occupantsByCell[i]} person(s)</span>
        <span className="text-slate-500">Coverage</span><span>{status}</span>
        <span className="text-slate-500">Devices</span><span className="break-words">{devs.length ? devs.join(', ') : 'none reach this zone'}</span>
      </div>
    </div>
  )
}
