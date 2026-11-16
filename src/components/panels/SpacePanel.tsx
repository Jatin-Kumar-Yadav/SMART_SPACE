import { Download, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, SelectBox, TextInput, Toggle } from '@/components/ui/controls'
import { exportProject, serializeProject } from '@/database/projectIO'
import { getRepository } from '@/database/repository'
import { CATALOG } from '@/objects/catalog'
import { useEditor, type WallMode } from '@/store/editorStore'
import { toast } from '@/store/uiStore'
import type { LengthUnit, SpaceType } from '@/types'
import { formatLength, fromMeters, toMeters } from '@/utils/units'

export const SPACE_TYPES: { value: SpaceType; label: string }[] = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'seminar-hall', label: 'Seminar Hall' },
  { value: 'auditorium', label: 'Auditorium' },
  { value: 'office', label: 'Office' },
  { value: 'conference-room', label: 'Conference Room' },
  { value: 'house', label: 'House' },
  { value: 'custom', label: 'Custom' },
]
export const UNITS: { value: LengthUnit; label: string }[] = [
  { value: 'm', label: 'Metres' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'ft', label: 'Feet' },
]

export function downloadText(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportCurrentSpace() {
  const space = useEditor.getState().space
  if (!space) return
  const file = await exportProject(space, getRepository())
  downloadText(`${space.name.replace(/[^\w-]+/g, '_')}.smartspace.json`, serializeProject(file))
  toast('Project exported as JSON', 'success')
}

export function SpacePanel() {
  const space = useEditor((s) => s.space!)
  const apply = useEditor((s) => s.apply)
  const rename = useEditor((s) => s.renameSpace)
  const setDimensions = useEditor((s) => s.setDimensions)
  const selectWall = useEditor((s) => s.selectWall)
  const selectedWall = useEditor((s) => s.selectedWallId)
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const wallMode = useEditor((s) => s.wallMode)
  const showCeiling = useEditor((s) => s.showCeiling)
  const markers = useEditor((s) => s.showDeviceMarkers)
  const people = useEditor((s) => s.showOccupants)
  const snapSize = useEditor((s) => s.snapSize)
  const set = useEditor((s) => s.set)
  const u = space.unit
  const area = space.dims.length * space.dims.width
  const changeDim = (k: 'length' | 'width' | 'height', v: number) => {
    const next = { ...space.dims, [k]: Math.max(0.5, toMeters(v, u)) }
    const outside = space.objects.filter((o) => !o.wall && (o.position[0] > next.length || o.position[2] > next.width)).length
    if (outside && !confirm(`${outside} object(s) would end up outside the smaller room. Resize anyway?`)) return
    setDimensions(next)
  }
  const interior = space.walls.filter((w) => !w.perimeter)
  return (
    <>
      <Section title="Space">
        <Field label="Name"><TextInput value={space.name} maxLength={60} onCommit={(v) => v.trim() && rename(v.trim())} /></Field>
        <Field label="Type"><SelectBox<SpaceType> value={space.type} onChange={(type) => apply((s) => ({ ...s, type }))} options={SPACE_TYPES} /></Field>
        <Field label="Units"><SelectBox<LengthUnit> value={u} onChange={(unit) => apply((s) => ({ ...s, unit }))} options={UNITS} /></Field>
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
      <Section title="Interior walls" right={<Button size="sm" variant={tool === 'wall' ? 'active' : 'secondary'} onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}><PenLine size={12} />{tool === 'wall' ? 'Drawing…' : 'Draw wall'}</Button>}>
        {interior.length === 0 && <p className="text-[11px] text-slate-400">No interior walls yet. Draw walls to split the space into rooms, then add doors and windows to them.</p>}
        {interior.map((w, i) => (
          <button key={w.id} onClick={() => { selectWall(w.id); }} className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-left text-[12px] ${selectedWall === w.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <span>Wall {i + 1}</span><span className="text-slate-500">{Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]).toFixed(2)} m</span>
          </button>
        ))}
        <p className="text-[11px] text-slate-400">Select a wall to edit its thickness and height in the Properties tab.</p>
      </Section>
      <Section title="Display">
        <Field label="Walls facing the camera"><SelectBox<WallMode> value={wallMode} onChange={(wallMode) => set({ wallMode })} options={[{ value: 'auto', label: 'Cut away (dollhouse)' }, { value: 'full', label: 'Always full height' }, { value: 'low', label: 'Always low' }]} /></Field>
        <Field label="Snap size (m)"><NumberInput value={snapSize} step={0.05} min={0.05} max={2} onCommit={(snapSize) => set({ snapSize })} /></Field>
        <Toggle checked={showCeiling} onChange={(showCeiling) => set({ showCeiling })} label="Show ceiling" />
        <Toggle checked={markers} onChange={(showDeviceMarkers) => set({ showDeviceMarkers })} label="Highlight environmental devices" />
        <Toggle checked={people} onChange={(showOccupants) => set({ showOccupants })} label="Show occupants" />
      </Section>
      <Section title="Project file">
        <Button size="sm" onClick={() => void exportCurrentSpace()}><Download size={12} />Export JSON</Button>
        <p className="text-[11px] text-slate-400">Includes uploaded textures. Import a project file from the dashboard. {space.objects.filter((o) => CATALOG[o.kind].category === 'device').length} devices · {space.objects.length} objects.</p>
      </Section>
    </>
  )
}
