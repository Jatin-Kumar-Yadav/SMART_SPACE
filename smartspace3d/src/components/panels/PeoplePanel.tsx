import { Shuffle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, Slider, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { CATALOG } from '@/objects/catalog'
import { seatCapacityOf, totalSeatCapacity } from '@/simulation/occupancy'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'
import type { OccupancyMode } from '@/types'

export function PeoplePanel() {
  const space = useEditor((s) => s.space!)
  const sc = activeScenario(space)
  const update = useEditor((s) => s.updateScenario)
  const generate = useEditor((s) => s.generatePeople)
  const clear = useEditor((s) => s.clearPeople)
  const updateObject = useEditor((s) => s.updateObject)
  const select = useEditor((s) => s.select)
  const snap = useSim((s) => s.snapshot)
  const capacity = totalSeatCapacity(space.objects)
  const occupied = sc.occupants.length
  const seatables = space.objects.filter((o) => CATALOG[o.kind].seat)
  const under = snap?.coverage.filter((c) => c.status === 'uncovered').length ?? 0
  const setMode = (mode: OccupancyMode) => update(sc.id, { occupancy: { ...sc.occupancy, mode } })
  return (
    <>
      <Section title="Seat capacity">
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {[['Capacity', capacity], ['Occupied', occupied], ['Free', Math.max(0, capacity - occupied)], ['Filled', `${capacity ? Math.round((occupied / capacity) * 100) : 0}%`]].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-slate-200 py-1.5"><div className="text-[10px] uppercase tracking-wide text-slate-500">{l}</div><div className="text-base font-semibold text-slate-900">{v}</div></div>
          ))}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue-500" style={{ width: `${capacity ? (occupied / capacity) * 100 : 0}%` }} /></div>
      </Section>
      <Section title="Generate people">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-0.5 text-[12px] font-medium">
          {(['random', 'fixed', 'percentage'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn('rounded py-1 capitalize', sc.occupancy.mode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500')}>{m === 'percentage' ? '% of seats' : m}</button>
          ))}
        </div>
        {sc.occupancy.mode === 'random' && <p className="text-[11px] leading-snug text-slate-500">Two random draws: first how many people (1 … capacity), then which free seat slots they take. One person per slot.</p>}
        {sc.occupancy.mode === 'fixed' && <Field label="Number of people"><NumberInput value={sc.occupancy.fixed} min={0} max={capacity} step={1} digits={0} onCommit={(fixed) => update(sc.id, { occupancy: { ...sc.occupancy, fixed } })} /></Field>}
        {sc.occupancy.mode === 'percentage' && <Field label={`Occupancy ${sc.occupancy.percentage}%`}><Slider value={sc.occupancy.percentage} min={0} max={100} step={1} onChange={() => undefined} onCommit={(percentage) => update(sc.id, { occupancy: { ...sc.occupancy, percentage } })} /></Field>}
        <div className="flex gap-1.5">
          <Button variant="default" onClick={generate} disabled={capacity === 0}><Shuffle size={13} />Generate people</Button>
          <Button onClick={clear} disabled={occupied === 0}><Trash2 size={13} />Clear</Button>
        </div>
        {capacity === 0 && <p className="text-[11px] text-amber-700">No seat slots yet — add chairs, benches or sofas.</p>}
        <Field label="Sensible heat per person (W)" hint="Seated adult ≈ 75 W"><NumberInput value={sc.sim.occupantHeatW} step={5} min={0} digits={0} onCommit={(occupantHeatW) => update(sc.id, { sim: { ...sc.sim, occupantHeatW }, occupants: sc.occupants.map((o) => ({ ...o, heatW: occupantHeatW })) })} /></Field>
      </Section>
      {snap && occupied > 0 && (
        <Section title="Environmental coverage">
          <div className={cn('rounded-md border p-2 text-[12px]', under ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
            {under ? `${under} occupant(s) are outside every AC / fan influence region. They stay in the simulation and are flagged as underserved.` : 'Every occupant is reached by at least one device.'}
          </div>
        </Section>
      )}
      <Section title={`Seating objects (${seatables.length})`}>
        {seatables.length === 0 && <p className="text-[11px] text-slate-400">Chairs, benches, sofas and beds appear here.</p>}
        <div className="flex max-h-72 flex-col gap-1 overflow-auto">
          {seatables.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1">
              <button className="min-w-0 truncate text-left text-[12px] text-slate-800 hover:text-blue-700" onClick={() => select([o.id])}>{o.name}</button>
              <span className="shrink-0 text-[11px] text-slate-500">{seatCapacityOf(o)} seat(s)</span>
              <Toggle checked={!!o.seatable} onChange={(seatable) => updateObject(o.id, { seatable })} />
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
