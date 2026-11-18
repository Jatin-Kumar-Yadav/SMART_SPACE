import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NumberInput, Slider } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { LUX_RANGE, sampleSensor, TEMP_RANGE } from '@/iot/simbridge'
import { useEditor } from '@/store/editorStore'
import { injectSensor, useIot } from '@/store/iotStore'
import { useLive } from '@/store/liveStore'
import { useSim } from '@/store/simStore'

/** Click a sensor → set what it reads. Simulated: goes into the shared simulation. Live Hardware: shows what the board reports. */
export function SensorPopover({ partId, at, onClose }: { partId: string; at: { x: number; y: number }; onClose: () => void }) {
  const plan = useIot((s) => s.plan)
  const injected = useIot((s) => s.injected)
  const space = useEditor((s) => s.space)!
  const snap = useSim((s) => s.snapshot)
  const readings = useLive((s) => s.readings)
  const part = plan?.parts.find((p) => p.id === partId)
  const sp = part?.sensorId ? space.hardware?.sensors.find((x) => x.id === part.sensorId) : undefined
  const source = useIot((s) => s.sensorSource[partId] ?? 'simulated')
  const setSource = (v: 'simulated' | 'live') => useIot.setState((s) => ({ sensorSource: { ...s.sensorSource, [partId]: v } }))
  const isTemp = sp?.kind === 'temperature'
  const [lo, hi] = isTemp ? TEMP_RANGE : LUX_RANGE
  const measured = snap && sp ? sampleSensor(snap, space, sp) : null
  const [val, setVal] = useState<number>(() => injected[sp?.id ?? '']?.value ?? measured?.value ?? (isTemp ? 25 : 300))
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  if (!part || !sp || sp.kind === 'presence') return null
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v))
  const apply = (v: number) => { const c = clamp(v); setVal(c); injectSensor(sp, c) }
  const unit = isTemp ? '°C' : 'lx'
  const live = readings[part.id]
  const left = Math.min(at.x + 12, window.innerWidth - 300)
  const top = Math.min(at.y + 12, window.innerHeight - 280)
  return (
    <div role="dialog" aria-label={`${part.id} sensor value`} data-testid="sensor-popover" className="fixed z-50 w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl" style={{ left, top }}>
      <div className="mb-2 flex items-start justify-between">
        <div><p className="text-[12.5px] font-semibold text-slate-800">{part.id} · {sp.name}</p><p className="text-[10.5px] text-slate-500">at x {sp.position[0].toFixed(1)}, z {sp.position[2].toFixed(1)} m · zone {sp.zone}</p></div>
        <button aria-label="Close" onClick={onClose} className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><X size={14} /></button>
      </div>
      <div role="radiogroup" aria-label="Sensor source" className="mb-2 flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {([['simulated', 'Simulated'], ['live', 'Live Hardware']] as const).map(([m, label]) => (
          <button key={m} role="radio" aria-checked={source === m} onClick={() => setSource(m)} className={cn('flex-1 rounded-md px-2 py-1 text-[11.5px] font-medium', source === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white')}>{label}</button>
        ))}
      </div>
      {source === 'simulated' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Slider value={val} min={lo} max={hi} step={isTemp ? 0.5 : 10} onChange={setVal} onCommit={apply} />
            <NumberInput value={val} min={lo} max={hi} step={isTemp ? 0.5 : 10} digits={isTemp ? 1 : 0} suffix={unit} onCommit={apply} className="w-24" />
          </div>
          <p className="text-[11px] text-slate-600">Measured in the simulation now: <b data-testid="sensor-measured">{measured ? `${measured.value.toFixed(isTemp ? 1 : 0)} ${unit}` : '—'}</b></p>
          {injected[sp.id] && <p className="text-[11px] text-slate-500">Last set by you: {injected[sp.id].value.toFixed(isTemp ? 1 : 0)} {unit}. The room then evolves from that value; the fans, AC and lights react through the normal controller.</p>}
        </div>
      ) : (
        <p className="text-[11.5px] text-slate-600">{live && live.value != null ? <>Hardware reported <b>{live.value.toFixed(1)} {unit}</b>{live.calibrated === false ? ' (uncalibrated)' : ''}.</> : 'No reading from the board. Connect it in the Live Data tab; values are never invented.'} The sensor card now shows the hardware value. The simulation itself only takes hardware readings in Monitor / Control mode (Setup).</p>
      )}
    </div>
  )
}
