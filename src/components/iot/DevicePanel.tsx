import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/controls'
import { allRoomDevices } from '@/iot/requirements'
import { useEditor } from '@/store/editorStore'
import { updateHardware } from '@/store/iotStore'
import type { Space } from '@/types'

function MiniPlan({ space }: { space: Space }) {
  const { length: L, width: W } = space.dims
  const k = 220 / Math.max(L, W)
  const cfg = space.hardware
  return (
    <svg width={L * k + 8} height={W * k + 8} className="mx-auto" role="img" aria-label="Floor plan with devices and sensor points">
      <rect x={4} y={4} width={L * k} height={W * k} fill="#f8fafc" stroke="#94a3b8" />
      {space.objects.filter((o) => o.device).map((o) => {
        const ex = cfg?.excludedDeviceIds?.includes(o.id)
        return <circle key={o.id} cx={4 + o.position[0] * k} cy={4 + o.position[2] * k} r={3} fill={ex ? '#cbd5e1' : o.device!.type === 'light' ? '#eab308' : o.device!.type === 'fan' ? '#0ea5e9' : '#6366f1'} />
      })}
      {cfg?.sensors.map((s) => <rect key={s.id} x={4 + s.position[0] * k - 3} y={4 + s.position[2] * k - 3} width={6} height={6} fill={s.kind === 'temperature' ? '#ef4444' : s.kind === 'light' ? '#f59e0b' : '#22c55e'} stroke="#fff"><title>{s.name}</title></rect>)}
    </svg>
  )
}

export function DevicePanel() {
  const space = useEditor((s) => s.space)!
  const cfg = space.hardware
  const devs = allRoomDevices(space)
  const excluded = new Set(cfg?.excludedDeviceIds ?? [])
  const toggle = (id: string, on: boolean) => {
    const next = new Set(excluded)
    if (on) next.delete(id); else next.add(id)
    updateHardware({ excludedDeviceIds: [...next] }, { reposition: true })
  }
  return (
    <aside className="flex w-[250px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white" aria-label="Room devices and sensor points">
      <section className="border-b border-slate-200 px-3 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Room → prototype</h3>
        <MiniPlan space={space} />
        <p className="mt-1 text-center text-[10px] text-slate-400">devices: fan <span className="text-sky-500">●</span> AC <span className="text-indigo-500">●</span> light <span className="text-yellow-500">●</span> · sensors ■ (same coordinates as the 3D room)</p>
      </section>
      <section className="border-b border-slate-200 px-3 py-3">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Devices (include in prototype)</h3>
        {devs.length === 0 && <p className="text-[12px] text-slate-500">No fans, AC units or lights in this room yet.</p>}
        {devs.map((d) => (
          <label key={d.obj.id} className="flex cursor-pointer items-center gap-2 py-1 text-[12px] text-slate-700">
            <input type="checkbox" checked={!excluded.has(d.obj.id)} onChange={(e) => toggle(d.obj.id, e.target.checked)} />
            <span className="min-w-0 flex-1 truncate">{d.obj.name}</span>
            <span className="font-mono text-[10.5px] text-slate-400">{d.hwId}</span>
          </label>
        ))}
        {cfg?.acOutput !== undefined && devs.some((d) => d.kind === 'ac') && <p className="mt-1 text-[10.5px] text-slate-400">AC is represented by a status LED / small blower. Never a mains or compressor connection.</p>}
      </section>
      <section className="px-3 py-3">
        <div className="mb-1.5 flex items-center justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sensor points</h3>
          <Button size="iconSm" variant="ghost" aria-label="Re-propose sensor points" title="Re-propose sensor points" onClick={() => updateHardware({}, { reposition: true })}><RefreshCw size={12} /></Button></div>
        {cfg?.sensors.map((s) => (
          <div key={s.id} className="border-b border-slate-100 py-1.5 text-[11.5px]">
            <p className="font-medium text-slate-800">{s.name}</p>
            <p className="font-mono text-[10.5px] text-slate-500">x {s.position[0].toFixed(1)} · y {s.position[1].toFixed(1)} · z {s.position[2].toFixed(1)} m</p>
          </div>
        ))}
        <p className="mt-1.5 text-[10.5px] text-slate-400">Temperature at seated breathing height, at least 2 m from AC outlets. Light at the working plane.</p>
        <label className="mt-2 flex items-center justify-between text-[11.5px] text-slate-600">Motor supply (V)<NumberInput value={cfg?.motorSupplyV ?? 5} min={3} max={6} step={0.5} digits={1} onCommit={(v) => updateHardware({ motorSupplyV: v })} className="w-16" /></label>
      </section>
    </aside>
  )
}
