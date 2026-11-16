import { Copy, Eye, EyeOff, Lock, LockOpen, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, Slider, TextInput, Toggle } from '@/components/ui/controls'
import { CATALOG } from '@/objects/catalog'
import { placementIssue } from '@/objects/collision'
import { placeOnWall, sideOfWall } from '@/objects/spaceFactory'
import { seatCapacityOf } from '@/simulation/occupancy'
import { setWindowState } from '@/store/windowActions'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/uiStore'
import type { SceneObject, Vec3, Wall } from '@/types'
import { deg, rad } from '@/utils/math'
import { wallLength } from '@/utils/geometry'
import { DevicePanel } from './DevicePanel'

/** Apply an edit only when the resulting placement is valid; otherwise explain why. */
function tryEdit(obj: SceneObject, patch: Partial<SceneObject>) {
  const st = useEditor.getState()
  const space = st.space!
  const next = { ...obj, ...patch }
  const issue = placementIssue(next, space)
  if (issue) {
    toast(`Invalid placement: ${issue}`, 'warning')
    return
  }
  st.updateObject(obj.id, patch)
}

function ObjectProps({ obj }: { obj: SceneObject }) {
  const entry = CATALOG[obj.kind]
  const space = useEditor((s) => s.space!)
  const update = useEditor((s) => s.updateObject)
  const select = useEditor((s) => s.select)
  const dup = useEditor((s) => s.duplicateSelected)
  const remove = useEditor((s) => s.removeSelected)
  const rotate = useEditor((s) => s.rotateSelected)
  const wall: Wall | undefined = obj.wall ? space.walls.find((w) => w.id === obj.wall!.wallId) : undefined
  const scale = obj.dims[0] / entry.dims[0]
  const setPos = (i: 0 | 1 | 2, v: number) => {
    const p = [...obj.position] as Vec3
    p[i] = v
    tryEdit(obj, { position: p })
  }
  const setDim = (i: 0 | 1 | 2, v: number) => {
    const d = [...obj.dims] as Vec3
    d[i] = Math.max(0.05, v)
    if (obj.kind === 'column' || entry.mount === 'ceiling') {
      // keep ceiling items hung from the ceiling when their height changes
      const pos: Vec3 = entry.mount === 'ceiling' ? [obj.position[0], space.dims.height - d[1], obj.position[2]] : obj.position
      return tryEdit(obj, { dims: d, position: pos })
    }
    tryEdit(obj, { dims: d })
  }
  const setScale = (s: number) => {
    const f = Math.max(0.1, s)
    const d: Vec3 = [entry.dims[0] * f, entry.dims[1] * f, entry.dims[2] * f]
    if (entry.wallMounted && obj.wall) d[2] = obj.dims[2]
    const pos: Vec3 = entry.mount === 'ceiling' ? [obj.position[0], space.dims.height - d[1], obj.position[2]] : obj.position
    tryEdit(obj, { dims: d, position: pos })
  }
  const seatCap = seatCapacityOf(obj)
  return (
    <>
      <Section title="Object">
        <Field label="Name"><TextInput value={obj.name} onCommit={(name) => update(obj.id, { name })} /></Field>
        <div className="flex items-center justify-between text-[12px] text-slate-600">
          <span>Type</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{entry.label}{entry.category === 'device' ? ' · device' : ''}</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" onClick={dup}><Copy size={12} />Duplicate</Button>
          {!obj.wall && <Button size="sm" onClick={() => rotate(rad(90))}><RotateCw size={12} />Rotate 90°</Button>}
          <Button size="sm" variant="danger" onClick={remove}><Trash2 size={12} />Delete</Button>
        </div>
      </Section>
      <Section title="Position (m)">
        {obj.wall && wall ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Along wall" hint={`Wall length ${wallLength(wall).toFixed(1)} m`}>
              <NumberInput value={obj.wall.offset} step={0.1} min={0} max={wallLength(wall)} disabled={obj.locked} onCommit={(v) => {
                const moved = placeOnWall(obj, wall, v, wall.outward ? 1 : sideOfWall(wall, obj.position[0], obj.position[2]))
                tryEdit(obj, { position: moved.position, wall: moved.wall })
              }} />
            </Field>
            <Field label="Height (Y)"><NumberInput value={obj.position[1]} step={0.05} min={0} max={space.dims.height} disabled={obj.locked} onCommit={(v) => setPos(1, v)} /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Field label="X"><NumberInput value={obj.position[0]} step={0.25} disabled={obj.locked} onCommit={(v) => setPos(0, v)} /></Field>
            <Field label="Y"><NumberInput value={obj.position[1]} step={0.05} min={0} disabled={obj.locked || entry.mount === 'ceiling'} onCommit={(v) => setPos(1, v)} /></Field>
            <Field label="Z"><NumberInput value={obj.position[2]} step={0.25} disabled={obj.locked} onCommit={(v) => setPos(2, v)} /></Field>
          </div>
        )}
        {!obj.wall && <Field label="Rotation (°)"><NumberInput value={((deg(obj.rotationY) % 360) + 360) % 360} step={15} digits={0} disabled={obj.locked} onCommit={(v) => tryEdit(obj, { rotationY: rad(v) })} /></Field>}
      </Section>
      <Section title="Size (m)">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Width"><NumberInput value={obj.dims[0]} step={0.1} min={0.05} disabled={obj.locked} onCommit={(v) => setDim(0, v)} /></Field>
          <Field label="Height"><NumberInput value={obj.dims[1]} step={0.1} min={0.02} disabled={obj.locked} onCommit={(v) => setDim(1, v)} /></Field>
          <Field label="Length"><NumberInput value={obj.dims[2]} step={0.1} min={0.05} disabled={obj.locked || !!obj.wall} onCommit={(v) => setDim(2, v)} /></Field>
        </div>
        <Field label={`Scale ${(scale * 100).toFixed(0)}% of default`}><Slider value={Math.min(3, Math.max(0.3, scale))} min={0.3} max={3} step={0.05} onChange={() => undefined} onCommit={setScale} disabled={obj.locked} /></Field>
      </Section>
      <Section title="Appearance & state">
        {!entry.wallMounted && (
          <Field label="Colour"><div className="flex items-center gap-2"><input type="color" value={obj.color ?? entry.color ?? '#999999'} onChange={(e) => update(obj.id, { color: e.target.value }, true)} onBlur={() => useEditor.getState().endTransient(true)} onPointerDown={() => useEditor.getState().beginTransient()} className="h-7 w-10 cursor-pointer rounded border border-slate-200" /><span className="text-[12px] text-slate-500">{obj.color ?? entry.color}</span></div></Field>
        )}
        <div className="flex items-center justify-between">
          <Toggle checked={obj.visible} onChange={(visible) => update(obj.id, { visible })} label={obj.visible ? 'Visible' : 'Hidden'} />
          {obj.visible ? <Eye size={14} className="text-slate-400" /> : <EyeOff size={14} className="text-slate-400" />}
        </div>
        <div className="flex items-center justify-between">
          <Toggle checked={obj.locked} onChange={(locked) => update(obj.id, { locked })} label={obj.locked ? 'Locked' : 'Unlocked'} />
          {obj.locked ? <Lock size={14} className="text-slate-400" /> : <LockOpen size={14} className="text-slate-400" />}
        </div>
      </Section>
      {entry.seat && (
        <Section title="Seating">
          <Toggle checked={!!obj.seatable} onChange={(seatable) => update(obj.id, { seatable })} label="People can sit here" />
          <div className="text-[12px] text-slate-600">Seat slots: <b>{seatCap}</b></div>
          {obj.seatable && entry.seat.fixed === undefined && (
            <Field label="Override slot count" hint="Leave empty for automatic (length based)">
              <NumberInput value={obj.seatCountOverride ?? seatCap} step={1} min={0} max={20} digits={0} onCommit={(n) => update(obj.id, { seatCountOverride: n })} />
            </Field>
          )}
          {obj.kind === 'bed' && <Field label="Bed occupancy"><NumberInput value={obj.seatCountOverride ?? 2} min={0} max={4} digits={0} step={1} onCommit={(n) => update(obj.id, { seatCountOverride: n })} /></Field>}
        </Section>
      )}
      {obj.window && (
        <Section title="Window">
          <Toggle checked={obj.window.open} onChange={(open) => setWindowState(obj.id, open)} label={obj.window.open ? 'Open (ventilates)' : 'Closed'} />
          <p className="text-[11px] leading-snug text-slate-500">Glass transmits daylight even when closed. Opening only adds ventilation / heat exchange.</p>
          <Field label={`Glass transmittance ${(obj.window.transmittance * 100).toFixed(0)}%`}><Slider value={obj.window.transmittance} min={0} max={1} step={0.05} onChange={() => undefined} onCommit={(transmittance) => update(obj.id, { window: { ...obj.window!, transmittance } })} /></Field>
          <Field label={`Shading ${(obj.window.shading * 100).toFixed(0)}%`}><Slider value={obj.window.shading} min={0} max={1} step={0.05} onChange={() => undefined} onCommit={(shading) => update(obj.id, { window: { ...obj.window!, shading } })} /></Field>
          <Field label="Solar heat gain coefficient"><NumberInput value={obj.window.shgc} step={0.05} min={0} max={1} onCommit={(shgc) => update(obj.id, { window: { ...obj.window!, shgc } })} /></Field>
        </Section>
      )}
      {obj.device && <DevicePanel obj={obj} />}
      <div className="h-6" />
      <button className="hidden" onClick={() => select([])} />
    </>
  )
}

function WallProps({ wall }: { wall: Wall }) {
  const update = useEditor((s) => s.updateWall)
  const remove = useEditor((s) => s.removeWall)
  return (
    <>
      <Section title={wall.perimeter ? 'Perimeter wall' : 'Interior wall'}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Thickness (m)"><NumberInput value={wall.thickness} step={0.02} min={0.05} max={0.6} onCommit={(thickness) => update(wall.id, { thickness })} /></Field>
          <Field label="Height (m)"><NumberInput value={wall.height} step={0.1} min={0.5} max={10} onCommit={(height) => update(wall.id, { height })} /></Field>
        </div>
        {!wall.perimeter && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start X"><NumberInput value={wall.a[0]} step={0.25} onCommit={(v) => update(wall.id, { a: [v, wall.a[1]] })} /></Field>
              <Field label="Start Z"><NumberInput value={wall.a[1]} step={0.25} onCommit={(v) => update(wall.id, { a: [wall.a[0], v] })} /></Field>
              <Field label="End X"><NumberInput value={wall.b[0]} step={0.25} onCommit={(v) => update(wall.id, { b: [v, wall.b[1]] })} /></Field>
              <Field label="End Z"><NumberInput value={wall.b[1]} step={0.25} onCommit={(v) => update(wall.id, { b: [wall.b[0], v] })} /></Field>
            </div>
            <Field label="Colour"><input type="color" value={wall.color ?? '#f3f1ec'} onChange={(e) => update(wall.id, { color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-slate-200" /></Field>
            <Button variant="danger" size="sm" onClick={() => remove(wall.id)}><Trash2 size={12} />Delete wall (and its doors / windows)</Button>
          </>
        )}
        {wall.perimeter && <p className="text-[11px] text-slate-500">Perimeter walls follow the room dimensions — change them in the Space tab.</p>}
      </Section>
    </>
  )
}

function Empty() {
  const space = useEditor((s) => s.space!)
  const n = (f: (o: SceneObject) => boolean) => space.objects.filter(f).length
  return (
    <div className="p-4 text-[13px] text-slate-600">
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Nothing selected</h3>
      <p className="mb-3 text-slate-500">Click an object in the room, or drag one from the library. Shift-click adds to the selection.</p>
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        {[['Objects', space.objects.length], ['Furniture', n((o) => CATALOG[o.kind].category === 'furniture')], ['Devices', n((o) => CATALOG[o.kind].category === 'device')], ['Doors / windows', n((o) => !!CATALOG[o.kind].opening)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-slate-200 p-2"><div className="text-slate-500">{l}</div><div className="text-base font-semibold text-slate-900">{v}</div></div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">Shortcuts: R rotate · Del delete · Ctrl+D duplicate · Ctrl+Z / Y undo / redo · arrows nudge · G grid · F fit</p>
    </div>
  )
}

export function PropertiesPanel() {
  const space = useEditor((s) => s.space!)
  const selection = useEditor((s) => s.selection)
  const wallId = useEditor((s) => s.selectedWallId)
  const dup = useEditor((s) => s.duplicateSelected)
  const remove = useEditor((s) => s.removeSelected)
  const rotate = useEditor((s) => s.rotateSelected)
  const wall = wallId ? space.walls.find((w) => w.id === wallId) : undefined
  if (wall) return <WallProps wall={wall} />
  if (selection.length === 0) return <Empty />
  if (selection.length > 1) {
    return (
      <Section title={`${selection.length} objects selected`}>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" onClick={dup}><Copy size={12} />Duplicate</Button>
          <Button size="sm" onClick={() => rotate(rad(90))}><RotateCw size={12} />Rotate 90°</Button>
          <Button size="sm" variant="danger" onClick={remove}><Trash2 size={12} />Delete</Button>
        </div>
        <p className="text-[11px] text-slate-500">Drag any selected object to move the group. Select a single object to edit its properties.</p>
      </Section>
    )
  }
  const obj = space.objects.find((o) => o.id === selection[0])
  return obj ? <ObjectProps obj={obj} /> : <Empty />
}
