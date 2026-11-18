import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, SelectBox, TextInput } from '@/components/ui/controls'
import { Modal } from '@/components/ui/dialog'
import { SPACE_TYPES, UNITS } from '@/components/panels/SpacePanel'
import { getRepository } from '@/database/repository'
import { navigate } from '@/hooks/useHashRoute'
import { createSpace } from '@/objects/spaceFactory'
import { toast } from '@/store/uiStore'
import type { Dimensions, LengthUnit, SpaceType } from '@/types'
import { fromMeters, toMeters } from '@/utils/units'

const PRESETS: Record<SpaceType, Dimensions> = {
  classroom: { length: 9, width: 7, height: 3.2 },
  'seminar-hall': { length: 30, width: 20, height: 4 },
  auditorium: { length: 40, width: 30, height: 8 },
  office: { length: 12, width: 8, height: 3 },
  'conference-room': { length: 8, width: 5, height: 3 },
  house: { length: 14, width: 10, height: 3 },
  custom: { length: 20, width: 15, height: 4 },
}
const MAX_SIDE = 500

export function CreateSpaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<SpaceType>('classroom')
  const [unit, setUnit] = useState<LengthUnit>('m')
  const [dims, setDims] = useState<Dimensions>(PRESETS.classroom)
  const [busy, setBusy] = useState(false)
  const area = dims.length * dims.width
  const valid = dims.length >= 1 && dims.width >= 1 && dims.height >= 1.5 && dims.length <= MAX_SIDE && dims.width <= MAX_SIDE && dims.height <= 30
  const create = async () => {
    setBusy(true)
    try {
      const label = SPACE_TYPES.find((t) => t.value === type)!.label
      const s = createSpace({ name: name.trim() || `New ${label}`, type, dims, unit })
      await getRepository().save(s)
      toast(`“${s.name}” created`, 'success')
      onOpenChange(false)
      navigate({ kind: 'editor', id: s.id })
    } catch (e) {
      console.error(e)
      toast('Could not create the space', 'error')
    } finally {
      setBusy(false)
    }
  }
  const dimField = (k: keyof Dimensions, label: string) => (
    <Field label={label}>
      <NumberInput value={fromMeters(dims[k], unit)} min={0} step={unit === 'cm' ? 50 : 1} suffix={unit} onCommit={(v) => setDims({ ...dims, [k]: toMeters(v, unit) })} />
    </Field>
  )
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create space" description="Dimensions are real-world sizes — the camera decides how large the room appears.">
      <div className="flex flex-col gap-3">
        <Field label="Space name"><TextInput value={name} maxLength={60} placeholder="e.g. Physics Lab 204" autoFocus onCommit={setName} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Space type"><SelectBox<SpaceType> value={type} onChange={(t) => { setType(t); setDims(PRESETS[t]) }} options={SPACE_TYPES} /></Field>
          <Field label="Units"><SelectBox<LengthUnit> value={unit} onChange={setUnit} options={UNITS} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">{dimField('length', 'Length')}{dimField('width', 'Width')}{dimField('height', 'Height')}</div>
        <div className="rounded-lg bg-slate-50 p-2.5 text-[12px] text-slate-600">
          {dims.length.toFixed(1)} m × {dims.width.toFixed(1)} m × {dims.height.toFixed(1)} m = <b>{area.toFixed(0)} m²</b> floor, <b>{(area * dims.height).toFixed(0)} m³</b> air. Stored internally in metres.
        </div>
        {area > 2500 && valid && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-800">This is a very large space. Rendering stays smooth, but the thermal simulation grid will be coarse (about {Math.ceil(Math.sqrt(area / 12000))} m cells).</div>}
        {!valid && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-800">Length and width must be between 1 and {MAX_SIDE} m, and height between 1.5 and 30 m.</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" disabled={!valid || busy} onClick={create}>Create space</Button>
        </div>
      </div>
    </Modal>
  )
}
