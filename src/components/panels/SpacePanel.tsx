import { Field, NumberInput, Section, SelectBox, TextInput } from '@/components/ui/controls'
import { useEditor } from '@/store/editorStore'
import { SPACE_TYPES, type SpaceType } from '@/types'
import { formatLength, fromMeters, toMeters } from '@/utils/units'

export function SpacePanel() {
  const space = useEditor((s) => s.space!)
  const apply = useEditor((s) => s.apply)
  const rename = useEditor((s) => s.renameSpace)
  const setDimensions = useEditor((s) => s.setDimensions)
  const u = space.unit
  const area = space.dims.length * space.dims.width
  const changeDim = (k: 'length' | 'width' | 'height', v: number) => {
    const next = { ...space.dims, [k]: Math.max(0.5, toMeters(v, u)) }
    const outside = space.objects.filter((o) => !o.wall && (o.position[0] > next.length || o.position[2] > next.width)).length
    if (outside && !confirm(`${outside} object(s) would end up outside the smaller room. Resize anyway?`)) return
    setDimensions(next)
  }
  return (
    <>
      <Section title="Space">
        <Field label="Name"><TextInput value={space.name} maxLength={60} onCommit={(v) => v.trim() && rename(v.trim())} /></Field>
        <Field label="Type"><SelectBox<SpaceType> value={space.type} onChange={(type) => apply((s) => ({ ...s, type }))} options={SPACE_TYPES} /></Field>
      </Section>
      <Section title={`Dimensions (${u})`}>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Length"><NumberInput value={fromMeters(space.dims.length, u)} step={u === 'cm' ? 50 : 1} min={0.5} onCommit={(v) => changeDim('length', v)} /></Field>
          <Field label="Width"><NumberInput value={fromMeters(space.dims.width, u)} step={u === 'cm' ? 50 : 1} min={0.5} onCommit={(v) => changeDim('width', v)} /></Field>
          <Field label="Height"><NumberInput value={fromMeters(space.dims.height, u)} step={u === 'cm' ? 10 : 0.25} min={0.5} onCommit={(v) => changeDim('height', v)} /></Field>
        </div>
        <div className="text-[11px] text-slate-500">
          {formatLength(space.dims.length, 'm')} × {formatLength(space.dims.width, 'm')} × {formatLength(space.dims.height, 'm')} · {area.toFixed(0)} m² · {(area * space.dims.height).toFixed(0)} m³
        </div>
        {area > 2500 && <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">Large space: the simulation grid is coarsened automatically to stay responsive. Rendering is unaffected.</div>}
      </Section>
    </>
  )
}
