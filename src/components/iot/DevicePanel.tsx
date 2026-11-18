import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberInput, SelectBox, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { liveEstop } from '@/store/liveStore'
import type { HardwareRunMode } from '@/types'
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
    <aside className="absolute inset-y-0 left-0 z-20 flex w-[270px] flex-col overflow-y-auto border-r border-slate-200 bg-white shadow-xl" aria-label="Hardware setup" data-testid="setup-drawer">
      <section className="space-y-2 border-b border-slate-200 px-3 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Hardware options</h3>
        <SelectBox value={cfg?.controller ?? 'esp32'} onChange={(v) => updateHardware({ controller: v, pinOverrides: {} })} options={[{ value: 'esp32', label: 'Controller: ESP32' }, { value: 'uno', label: 'Controller: Arduino Uno' }, { value: 'rpi', label: 'Controller: Raspberry Pi' }]} />
        <SelectBox value={cfg?.tempPart ?? 'dht22'} onChange={(v) => updateHardware({ tempPart: v, pinOverrides: {} })} options={[{ value: 'dht22', label: 'Temperature: DHT22' }, { value: 'ds18b20', label: 'Temperature: DS18B20' }, { value: 'bme280', label: 'Temperature: BME280' }]} />
        <SelectBox value={cfg?.lightPart ?? 'bh1750'} onChange={(v) => updateHardware({ lightPart: v, pinOverrides: {} })} options={[{ value: 'bh1750', label: 'Light: BH1750' }, { value: 'ldr', label: 'Light: LDR' }]} />
        <SelectBox value={cfg?.acOutput ?? 'led'} onChange={(v) => updateHardware({ acOutput: v })} options={[{ value: 'led', label: 'AC shown as: status LED' }, { value: 'blower', label: 'AC shown as: small blower' }, { value: 'both', label: 'AC shown as: LED + blower' }]} />
        <label className="flex items-center justify-between text-[11.5px] text-slate-600">Sensor zones<NumberInput value={cfg?.zoneCount ?? cfg?.sensors.filter((x) => x.kind === 'temperature').length ?? 1} min={1} max={8} step={1} digits={0} onCommit={(v) => updateHardware({ zoneCount: Math.round(v) }, { reposition: true })} className="w-16" /></label>
        <Toggle checked={!!cfg?.includePresence} onChange={(v) => updateHardware({ includePresence: v }, { reposition: true })} label="PIR motion sensors" />
        <div role="radiogroup" aria-label="Run mode" className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {([['simulation', 'Simulation'], ['monitor', 'Monitor'], ['control', 'Control']] as [HardwareRunMode, string][]).map(([m, label]) => (
            <button key={m} role="radio" aria-checked={cfg?.runMode === m} onClick={() => updateHardware({ runMode: m })} className={cn('flex-1 rounded-md px-2 py-1 text-[11.5px] font-medium', cfg?.runMode === m ? (m === 'control' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : 'text-slate-600 hover:bg-white')}>{label}</button>
          ))}
        </div>
        {cfg?.runMode !== 'simulation' && <Button variant="danger" className="w-full border-red-400 font-bold" onClick={() => liveEstop()}>E-STOP all outputs</Button>}
      </section>
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
