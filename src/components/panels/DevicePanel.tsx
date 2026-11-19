import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, Slider, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { profileValue } from '@/simulation/influence'
import { setDevice } from '@/store/actions'
import { useEditor } from '@/store/editorStore'
import type { AcDevice, AirLevel, DeviceConfig, FanDevice, LightDevice, ProfilePoint, SceneObject } from '@/types'

type Air = FanDevice | AcDevice

function ModeSwitch({ id, mode }: { id: string; mode: 'auto' | 'manual' }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-0.5 text-[12px] font-medium">
      {(['auto', 'manual'] as const).map((m) => (
        <button key={m} onClick={() => setDevice(id, { mode: m })} className={cn('rounded py-1 uppercase tracking-wide', mode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500')}>{m}</button>
      ))}
    </div>
  )
}

/** Plot of the directional cooling profile (relative strength vs distance along the airflow axis). */
function ProfilePlot({ profile }: { profile: ProfilePoint[] }) {
  const pts = [...profile].sort((a, b) => a.x - b.x)
  if (pts.length < 2) return null
  const x0 = pts[0].x
  const x1 = pts[pts.length - 1].x
  const vmax = Math.max(...pts.map((p) => p.v), 0.001)
  const W = 236
  const H = 70
  const X = (x: number) => 6 + ((x - x0) / (x1 - x0 || 1)) * (W - 12)
  const Y = (v: number) => H - 8 - (v / vmax) * (H - 16)
  const samples = Array.from({ length: 60 }, (_, i) => x0 + ((x1 - x0) * i) / 59)
  const d = samples.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(profileValue(pts, x)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md border border-slate-200 bg-slate-50" role="img" aria-label="Cooling profile">
      <line x1={6} x2={W - 6} y1={H - 8} y2={H - 8} stroke="#cbd5e1" />
      <path d={d} fill="none" stroke="#2a78d6" strokeWidth={2} />
      {pts.map((p) => <circle key={p.x} cx={X(p.x)} cy={Y(p.v)} r={3} fill="#fff" stroke="#2a78d6" strokeWidth={1.5} />)}
    </svg>
  )
}

function LevelTable({ obj, d }: { obj: SceneObject; d: Air }) {
  const update = useEditor((s) => s.updateDevice)
  const isAc = d.type === 'ac'
  const patch = (i: number, p: Partial<AirLevel>) =>
    update(obj.id, (cur) => {
      const c = cur as Air
      const levels = c.levels.map((l, j) => (j === i ? { ...l, ...p } : l))
      if (c.type === 'ac' && (p.coolingFrac !== undefined)) levels[i].powerW = Math.round((c.capacityW * levels[i].coolingFrac) / c.cop)
      return { ...c, levels }
    })
  const add = () =>
    update(obj.id, (cur) => {
      const c = cur as Air
      const last = c.levels[c.levels.length - 1]
      const next: AirLevel = { ...last, label: `Level ${c.levels.length}`, radius: +(last.radius * 1.2).toFixed(1), length: +(last.length * 1.2).toFixed(1), width: +(last.width * 1.15).toFixed(1), effectC: +(last.effectC * 1.3 + 0.5).toFixed(1), airflow: +(last.airflow * 1.3).toFixed(2), powerW: Math.round(last.powerW * 1.3), coolingFrac: c.type === 'ac' ? Math.min(1, last.coolingFrac) : 0 }
      return { ...c, levels: [...c.levels, next] }
    })
  const remove = (i: number) =>
    update(obj.id, (cur) => {
      const c = cur as Air
      const levels = c.levels.filter((_, j) => j !== i)
      return { ...c, levels, level: Math.min(c.level, levels.length - 1) }
    })
  return (
    <div className="flex flex-col gap-2">
      {d.levels.map((l, i) =>
        i === 0 ? (
          <div key={i} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] text-slate-500">Level 0 — OFF</div>
        ) : (
          <div key={i} className="rounded-md border border-slate-200 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-slate-800">Level {i}</span>
              {d.levels.length > 2 && <button className="text-slate-400 hover:text-red-600" title="Remove level" onClick={() => remove(i)}><Trash2 size={12} /></button>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(!isAc || d.shape === 'circle') && <Field label="Radius (m)"><NumberInput value={l.radius} step={0.25} min={0.25} onCommit={(radius) => patch(i, { radius })} /></Field>}
              {isAc && d.shape !== 'circle' && <Field label="Length (m)"><NumberInput value={l.length} step={0.25} min={0.5} onCommit={(length) => patch(i, { length })} /></Field>}
              {isAc && d.shape !== 'circle' && <Field label="Width (m)"><NumberInput value={l.width} step={0.25} min={0.5} onCommit={(width) => patch(i, { width })} /></Field>}
              <Field label={isAc ? 'Centre effect (°C)' : 'Perceived Δ (°C)'}><NumberInput value={l.effectC} step={0.5} min={0} max={15} onCommit={(effectC) => patch(i, { effectC })} /></Field>
              {isAc && <Field label="Capacity share"><NumberInput value={l.coolingFrac * 100} step={5} min={0} max={100} digits={0} suffix="%" onCommit={(v) => patch(i, { coolingFrac: v / 100 })} /></Field>}
              <Field label="Airflow (m/s)"><NumberInput value={l.airflow} step={0.05} min={0} max={3} onCommit={(airflow) => patch(i, { airflow })} /></Field>
              {!isAc && <Field label="Power (W)"><NumberInput value={l.powerW} step={5} min={0} digits={0} onCommit={(powerW) => patch(i, { powerW })} /></Field>}
            </div>
          </div>
        ),
      )}
      <Button size="sm" onClick={add}><Plus size={13} />Add level</Button>
    </div>
  )
}

function AirPanel({ obj, d }: { obj: SceneObject; d: Air }) {
  const update = useEditor((s) => s.updateDevice)
  const isAc = d.type === 'ac'
  return (
    <>
      <Section title={isAc ? 'AC unit' : 'Fan'}>
        <ModeSwitch id={obj.id} mode={d.mode} />
        <p className="text-[11px] leading-snug text-slate-500">{d.mode === 'auto' ? 'The controller chooses the level to keep occupied zones at the target.' : 'Manual: the controller will not change this device.'}</p>
        <div className="flex flex-wrap gap-1">
          {d.levels.map((_, i) => (
            <button key={i} onClick={() => setDevice(obj.id, { mode: 'manual', level: i })} className={cn('h-7 min-w-9 rounded-md border px-2 text-[12px] font-medium', d.level === i ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>{i === 0 ? 'OFF' : i}</button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">Clicking a level switches the device to manual.</p>
      </Section>

      {isAc && d.shape === 'directional' && (
        <Section title="Directional cooling profile" right={<Button size="sm" onClick={() => update(obj.id, (c) => { const a = c as AcDevice; const last = a.profile[a.profile.length - 1]; return { ...a, profile: [...a.profile, { x: (last?.x ?? 0) + 1, v: 0 }] } })}><Plus size={12} />Point</Button>}>
          <ProfilePlot profile={d.profile} />
          <p className="text-[11px] leading-snug text-slate-500">Position along the airflow axis (m, 0 = unit) and relative strength. Values between points are interpolated.</p>
          {d.profile.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
              <Field label={i === 0 ? 'Position (m)' : ''}><NumberInput value={p.x} step={0.5} onCommit={(x) => update(obj.id, (c) => ({ ...(c as AcDevice), profile: (c as AcDevice).profile.map((q, j) => (j === i ? { ...q, x } : q)) }))} /></Field>
              <Field label={i === 0 ? 'Strength' : ''}><NumberInput value={p.v} step={0.5} min={0} onCommit={(v) => update(obj.id, (c) => ({ ...(c as AcDevice), profile: (c as AcDevice).profile.map((q, j) => (j === i ? { ...q, v } : q)) }))} /></Field>
              <Button variant="ghost" size="iconSm" disabled={d.profile.length <= 2} onClick={() => update(obj.id, (c) => ({ ...(c as AcDevice), profile: (c as AcDevice).profile.filter((_, j) => j !== i) }))}><Trash2 size={12} /></Button>
            </div>
          ))}
        </Section>
      )}
      <Section title="Operating levels">
        <p className="text-[11px] leading-snug text-slate-500">
          {isAc ? 'The centre effect is a perceived-comfort offset; actual heat removal follows the capacity share and the energy balance.' : 'Fan “perceived Δ” values are comfort offsets (wind-chill style), not a reduction of the air temperature. Fans mix air and add a little motor heat.'}
        </p>
        <LevelTable obj={obj} d={d} />
        <p className="text-[11px] text-slate-400">Drag the handles on the floor overlay to resize the influence region of the current level.</p>
      </Section>
    </>
  )
}

function LightPanel({ obj, d }: { obj: SceneObject; d: LightDevice }) {
  const update = useEditor((s) => s.updateDevice)
  return (
    <>
      <Section title="Light">
        <ModeSwitch id={obj.id} mode={d.mode} />
        <Toggle checked={d.on} onChange={(on) => setDevice(obj.id, { mode: 'manual', on })} label={d.on ? 'On' : 'Off'} />
        <Field label={`Dimming ${Math.round(d.dimming * 100)}%`}><Slider value={d.dimming} min={0} max={1} step={0.05} onChange={(v) => setDevice(obj.id, { mode: 'manual', dimming: v })} /></Field>
        <p className="text-[11px] text-slate-400">Changing on/off or dimming switches the light to manual. In AUTO the controller dims lamps to reach the target lux.</p>
      </Section>
      <Section title="Photometrics">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Luminous flux (lm)"><NumberInput value={d.lumens} step={100} min={0} digits={0} onCommit={(lumens) => update(obj.id, (c) => ({ ...(c as LightDevice), lumens }))} /></Field>
          <Field label="Power (W)"><NumberInput value={d.powerW} step={1} min={0} digits={0} onCommit={(powerW) => update(obj.id, (c) => ({ ...(c as LightDevice), powerW }))} /></Field>
        </div>
      </Section>
    </>
  )
}

export function DevicePanel({ obj }: { obj: SceneObject }) {
  const d: DeviceConfig | undefined = obj.device
  if (!d) return null
  return d.type === 'light' ? <LightPanel obj={obj} d={d} /> : <AirPanel obj={obj} d={d} />
}
