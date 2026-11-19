import { Shuffle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, Slider, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { CATALOG } from '@/objects/catalog'
import {
  allSeatSlots,
  seatCapacityOf,
  totalSeatCapacity,
} from '@/simulation/occupancy'
import { activeScenario, useEditor } from '@/store/editorStore'
import type { OccupancyMode } from '@/types'
import { mulberry32, newId, randInt, randomSeed, shuffle } from '@/utils/math'
import { toast } from '@/store/uiStore'

export function PeoplePanel() {
  const space = useEditor((s) => s.space!)
  const sc = activeScenario(space)
  const update = useEditor((s) => s.updateScenario)
  const clear = useEditor((s) => s.clearPeople)
  const updateObject = useEditor((s) => s.updateObject)
  const select = useEditor((s) => s.select)
  const capacity = totalSeatCapacity(space.objects)
  const occupied = sc.occupants.length
  const seatables = space.objects.filter((o) => CATALOG[o.kind].seat)

  const applyTargetCount = (targetCount: number, nextOcc: typeof sc.occupancy) => {
    if (capacity === 0) {
      update(sc.id, { occupancy: nextOcc, occupants: [], occupancySource: 'random' })
      return
    }
    const count = Math.min(capacity, Math.max(0, targetCount))
    const allSlots = allSeatSlots(space.objects)
    const slotKeySet = new Set(allSlots.map((s) => s.key))
    let nextOccupants = sc.occupants.filter((o) => slotKeySet.has(o.seatKey))

    if (nextOccupants.length > count) {
      nextOccupants = nextOccupants.slice(0, count)
    } else if (nextOccupants.length < count) {
      const occupiedKeys = new Set(nextOccupants.map((o) => o.seatKey))
      const availableSlots = allSlots.filter((s) => !occupiedKeys.has(s.key))
      const needed = count - nextOccupants.length
      const added = availableSlots.slice(0, needed).map((slot) => ({
        id: newId('occ'),
        seatKey: slot.key,
        objectId: slot.objectId,
        slotIndex: slot.index,
        position: slot.position,
        facing: slot.facing,
        activity: 'seated' as const,
        heatW: sc.sim.occupantHeatW,
      }))
      nextOccupants = [...nextOccupants, ...added]
    }
    update(sc.id, { occupancy: nextOcc, occupants: nextOccupants, occupancySource: 'random' })
  }

  const applyPercentage = (percentage: number) => {
    const nextOcc = { ...sc.occupancy, percentage, mode: 'percentage' as const }
    const targetCount = Math.round((percentage / 100) * capacity)
    applyTargetCount(targetCount, nextOcc)
  }

  const applyFixed = (fixed: number) => {
    const nextOcc = { ...sc.occupancy, fixed, mode: 'fixed' as const }
    applyTargetCount(Math.floor(fixed), nextOcc)
  }

  const generateRandom = (overrideMode?: OccupancyMode) => {
    if (capacity === 0) {
      update(sc.id, { occupancy: { ...sc.occupancy, mode: overrideMode ?? sc.occupancy.mode }, occupants: [], occupancySource: 'random' })
      return
    }
    const mode = overrideMode ?? sc.occupancy.mode
    const nextOcc = { ...sc.occupancy, mode }
    const rng = mulberry32(randomSeed())
    let count: number
    if (mode === 'percentage') {
      count = Math.min(capacity, Math.max(0, Math.round((sc.occupancy.percentage / 100) * capacity)))
    } else if (mode === 'fixed') {
      count = Math.min(capacity, Math.max(0, Math.floor(sc.occupancy.fixed)))
    } else {
      if (capacity > 1) {
        const choices = Array.from({ length: capacity }, (_, i) => i + 1).filter((c) => c !== occupied)
        count = choices.length ? choices[Math.floor(rng() * choices.length)] : randInt(rng, 1, capacity)
      } else {
        count = 1
      }
    }
    const allSlots = allSeatSlots(space.objects)
    const occ = shuffle(rng, allSlots)
      .slice(0, count)
      .map((slot) => ({
        id: newId('occ'),
        seatKey: slot.key,
        objectId: slot.objectId,
        slotIndex: slot.index,
        position: slot.position,
        facing: slot.facing,
        activity: 'seated' as const,
        heatW: sc.sim.occupantHeatW,
      }))
    update(sc.id, { occupancy: nextOcc, occupants: occ, occupancySource: 'random' })
    if (occ.length) toast(`${occ.length} people generated`, 'success')
  }

  const setMode = (mode: OccupancyMode) => {
    if (mode === 'percentage') {
      applyPercentage(sc.occupancy.percentage)
    } else if (mode === 'fixed') {
      applyFixed(sc.occupancy.fixed)
    } else {
      generateRandom('random')
    }
  }

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
        {sc.occupancy.mode === 'fixed' && <Field label="Number of people"><NumberInput value={sc.occupancy.fixed} min={0} max={capacity} step={1} digits={0} onCommit={applyFixed} /></Field>}
        {sc.occupancy.mode === 'percentage' && <Field label={`Occupancy ${sc.occupancy.percentage}%`}><Slider value={sc.occupancy.percentage} min={0} max={100} step={1} onChange={applyPercentage} onCommit={applyPercentage} /></Field>}
        <div className="flex gap-1.5">
          <Button variant="default" onClick={() => generateRandom()} disabled={capacity === 0}><Shuffle size={13} />Generate people</Button>
          <Button onClick={clear} disabled={occupied === 0}><Trash2 size={13} />Clear</Button>
        </div>
        {capacity === 0 && <p className="text-[11px] text-amber-700">No seat slots yet — add chairs, benches or sofas.</p>}
      </Section>

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
