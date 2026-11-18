import { Cpu, ImagePlus, PanelLeftClose, PanelLeftOpen, Search, Trash2 } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, Slider, Toggle } from '@/components/ui/controls'
import { CATALOG_LIST, type CatalogEntry } from '@/objects/catalog'
import { cn } from '@/lib/utils'
import { getRepository } from '@/database/repository'
import { useEditor } from '@/store/editorStore'
import { useLayout, type LeftTab } from '@/store/layoutStore'
import { toast } from '@/store/uiStore'
import { FLOOR_PRESETS } from '@/three/textures'
import { kindIcons } from '@/three/thumbnails'
import { forgetUploadedTexture } from '@/three/useFloorTexture'
import type { FloorMaterial, FloorPresetId, StoredTexture } from '@/types'

let iconCache: Record<string, string> | null = null
function useIcons() {
  const [icons, setIcons] = useState<Record<string, string>>(iconCache ?? {})
  useEffect(() => {
    if (iconCache) return
    const t = setTimeout(() => {
      try {
        iconCache = kindIcons()
        setIcons(iconCache)
      } catch (e) {
        console.warn('library thumbnails unavailable', e)
      }
    }, 50)
    return () => clearTimeout(t)
  }, [])
  return icons
}

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'architecture', label: 'Walls' },
  { id: 'environment', label: 'Devices' },
  { id: 'materials', label: 'Floor' },
]

function Item({ e, icon }: { e: CatalogEntry; icon?: string }) {
  const addObject = useEditor((s) => s.addObject)
  const device = e.category === 'device'
  return (
    <button
      draggable
      onDragStart={(ev) => {
        useLayout.getState().set({ dragKind: e.kind })
        ev.dataTransfer.setData('text/x-ss-kind', e.kind)
        ev.dataTransfer.effectAllowed = 'copy'
      }}
      onDragEnd={() => {
        useLayout.getState().set({ dragKind: null })
        useEditor.getState().setGhost(null)
      }}
      onClick={() => addObject(e.kind)}
      title={`Drag into the room, or click to add (${e.dims.map((d) => d.toFixed(2)).join(' × ')} m)`}
      className={cn(
        'group relative flex flex-col items-center gap-1 rounded-lg border bg-white p-1.5 text-center transition hover:shadow-md active:cursor-grabbing',
        device ? 'border-teal-200 hover:border-teal-400' : 'border-slate-200 hover:border-blue-400',
      )}
    >
      {device && <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-teal-50 px-1 text-[9px] font-semibold text-teal-700"><Cpu size={9} />DEVICE</span>}
      <div className={cn('grid h-[68px] w-full place-items-center rounded-md', device ? 'bg-teal-50/60' : 'bg-slate-50')}>
        {icon ? <img src={icon} alt="" draggable={false} className="max-h-[64px] max-w-full object-contain" /> : <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />}
      </div>
      <span className="text-[12px] font-medium leading-tight text-slate-800">{e.label}</span>
    </button>
  )
}

function ObjectGrid({ tab }: { tab: LeftTab }) {
  const [q, setQ] = useState('')
  const icons = useIcons()
  const items = useMemo(() => {
    const cat = tab === 'furniture' ? 'furniture' : tab === 'architecture' ? 'architecture' : 'device'
    const needle = q.trim().toLowerCase()
    return CATALOG_LIST.filter((e) => e.category === cat && (!needle || e.label.toLowerCase().includes(needle) || e.tags.some((t) => t.includes(needle))))
  }, [tab, q])
  const wallTool = useEditor((s) => s.tool === 'wall')
  const setTool = useEditor((s) => s.setTool)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative m-3 mb-2">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search objects…" className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
      </div>
      <div className="ss-scroll min-h-0 flex-1 px-3 pb-3">
        {tab === 'architecture' && (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1 text-[12px] font-semibold text-slate-800">Interior walls</div>
            <p className="mb-2 text-[11px] leading-snug text-slate-500">Click the floor to set the start point, click again for the end. Doors and windows snap onto walls.</p>
            <Button variant={wallTool ? 'active' : 'secondary'} size="sm" onClick={() => setTool(wallTool ? 'select' : 'wall')}>{wallTool ? 'Drawing… (Esc to stop)' : 'Draw wall'}</Button>
          </div>
        )}
        {tab === 'environment' && <p className="mb-2 text-[11px] leading-snug text-slate-500">Environmental devices are drawn with a teal tag. Select one to see and drag its influence region.</p>}
        <div className="grid grid-cols-2 gap-2">{items.map((e) => <Item key={e.kind} e={e} icon={icons[e.kind]} />)}</div>
        {!items.length && <p className="py-6 text-center text-xs text-slate-400">No objects match “{q}”.</p>}
      </div>
    </div>
  )
}

// ───────────────────────── floor materials ─────────────────────────

export function useTextures() {
  const [list, setList] = useState<StoredTexture[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const reload = async () => {
    const t = await getRepository().listTextures()
    setList(t)
    setUrls((old) => {
      Object.values(old).forEach((u) => URL.revokeObjectURL(u))
      return Object.fromEntries(t.map((x) => [x.id, URL.createObjectURL(x.blob)]))
    })
  }
  useEffect(() => {
    void reload()
  }, [])
  return { list, urls, reload }
}

/** Reads, validates and stores an uploaded image; returns its texture id. */
export async function uploadTexture(file: File): Promise<string | null> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    toast('Please choose a PNG, JPG or WEBP image', 'warning')
    return null
  }
  if (file.size > 12 * 1024 * 1024) {
    toast('Image is larger than 12 MB — use a smaller tile image', 'warning')
    return null
  }
  const rec = await getRepository().saveTexture(file, file.name)
  toast(`Texture “${file.name}” imported`, 'success')
  return rec.id
}

export function MaterialEditor({ material, onChange }: { material: FloorMaterial; onChange: (p: Partial<FloorMaterial>) => void }) {
  const { list, urls, reload } = useTextures()
  const file = useRef<HTMLInputElement>(null)
  const space = useEditor((s) => s.space!)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-1.5">
        {FLOOR_PRESETS.map((p) => (
          <button key={p.id} onClick={() => onChange({ preset: p.id as FloorPresetId, textureId: undefined, tileSize: p.tile, roughness: p.roughness })} className={cn('flex flex-col items-center gap-1 rounded-md border p-1 text-[10px]', !material.textureId && material.preset === p.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300')}>
            <span className="h-7 w-full rounded" style={{ background: p.swatch }} />{p.label}
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Custom tile image</span>
          <Button size="sm" onClick={() => file.current?.click()}><ImagePlus size={13} />Import</Button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const id = await uploadTexture(f)
            if (id) {
              await reload()
              onChange({ textureId: id })
            }
          }} />
        </div>
        {list.length === 0 ? <p className="text-[11px] text-slate-400">Import a PNG / JPG / WEBP tile. One image = one physical tile of “Tile size”, repeated across the floor.</p> : (
          <div className="grid grid-cols-4 gap-1.5">
            {list.map((t) => (
              <div key={t.id} className="group relative">
                <button title={t.name} onClick={() => onChange({ textureId: t.id })} className={cn('block h-12 w-full overflow-hidden rounded-md border', material.textureId === t.id ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200')}>
                  {urls[t.id] && <img src={urls[t.id]} alt={t.name} className="h-full w-full object-cover" />}
                </button>
                <button title="Delete texture" className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 p-0.5 text-red-600 group-hover:block" onClick={async () => {
                  const used = space.floor.textureId === t.id || space.floorRegions.some((r) => r.material.textureId === t.id)
                  if (used && !confirm('This texture is used by this space. Delete it anyway? The floor will fall back to a preset.')) return
                  await getRepository().removeTexture(t.id)
                  forgetUploadedTexture(t.id)
                  if (material.textureId === t.id) onChange({ textureId: undefined })
                  void reload()
                }}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Toggle checked={material.stretch} onChange={(stretch) => onChange({ stretch })} label="Stretch one image over the whole floor" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tile size (m)" hint={material.stretch ? 'Ignored while stretching' : 'Physical size of one repeat'}><NumberInput value={material.tileSize} min={0.1} max={20} step={0.1} disabled={material.stretch} onCommit={(tileSize) => onChange({ tileSize })} /></Field>
        <Field label="Rotation (°)"><NumberInput value={material.rotation} step={15} digits={0} onCommit={(rotation) => onChange({ rotation })} /></Field>
        <Field label="Offset X"><NumberInput value={material.offset[0]} step={0.05} min={-1} max={1} onCommit={(v) => onChange({ offset: [v, material.offset[1]] })} /></Field>
        <Field label="Offset Z"><NumberInput value={material.offset[1]} step={0.05} min={-1} max={1} onCommit={(v) => onChange({ offset: [material.offset[0], v] })} /></Field>
      </div>
      <Field label={`Roughness ${material.roughness.toFixed(2)}`}><Slider value={material.roughness} min={0} max={1} onChange={(roughness) => onChange({ roughness })} /></Field>
      <Field label="Colour tint">
        <div className="flex items-center gap-2"><input type="color" value={material.tint} onChange={(e) => onChange({ tint: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-slate-200" /><span className="text-[12px] text-slate-500">{material.tint}</span></div>
      </Field>
    </div>
  )
}

function MaterialsTab() {
  const space = useEditor((s) => s.space!)
  const setFloor = useEditor((s) => s.setFloor)
  const addRegion = useEditor((s) => s.addRegion)
  const updateRegion = useEditor((s) => s.updateRegion)
  const removeRegion = useEditor((s) => s.removeRegion)
  return (
    <div className="ss-scroll min-h-0 flex-1">
      <Section title="Main floor"><MaterialEditor material={space.floor} onChange={setFloor} /></Section>
      <Section title="Floor regions" right={<Button size="sm" onClick={addRegion}>Add region</Button>}>
        {space.floorRegions.length === 0 && <p className="text-[11px] text-slate-400">Regions let a stage, lounge or entrance use a different material.</p>}
        {space.floorRegions.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 p-2">
            <div className="mb-2 flex items-center gap-2">
              <input className="h-7 min-w-0 flex-1 rounded border border-slate-200 px-2 text-[13px] font-medium" defaultValue={r.name} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => updateRegion(r.id, { name: e.target.value })} />
              <Button variant="danger" size="iconSm" title="Remove region" onClick={() => removeRegion(r.id)}><Trash2 size={13} /></Button>
            </div>
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {(['x', 'z', 'w', 'd'] as const).map((k) => (
                <Field key={k} label={{ x: 'X', z: 'Z', w: 'Width', d: 'Depth' }[k]}><NumberInput value={r[k]} step={0.5} min={k === 'x' || k === 'z' ? 0 : 0.5} onCommit={(v) => updateRegion(r.id, { [k]: v })} /></Field>
              ))}
            </div>
            <MaterialEditor material={r.material} onChange={(p) => updateRegion(r.id, { material: p })} />
          </div>
        ))}
      </Section>
    </div>
  )
}

export function LibraryPanel() {
  const tab = useLayout((s) => s.leftTab)
  const open = useLayout((s) => s.libraryOpen)
  const set = useLayout((s) => s.set)
  const toggle = (
    <Tip label={open ? 'Collapse object library' : 'Expand object library'} side="right">
      <button
        aria-label={open ? 'Collapse object library' : 'Expand object library'}
        aria-expanded={open}
        data-testid="library-toggle"
        onClick={() => set({ libraryOpen: !open })}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
      >
        {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
    </Tip>
  )
  // The panel keeps its place in the layout and animates its width, so the 3D view is never remounted or reset.
  return (
    <aside className={cn('flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ease-out', open ? 'w-[272px]' : 'w-10')} aria-label="Object library">
      <div className={cn('flex items-center border-b border-slate-200', open ? 'pr-1.5' : 'justify-center py-1.5')}>
        {open && (
          <div className="grid min-w-0 flex-1 grid-cols-4 text-[11px]">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => set({ leftTab: t.id })} className={cn('px-1 py-2.5 font-medium', tab === t.id ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800')}>{t.label}</button>
            ))}
          </div>
        )}
        {toggle}
      </div>
      {open && <div className="flex min-h-0 w-[272px] flex-1 flex-col">{tab === 'materials' ? <MaterialsTab /> : <ObjectGrid tab={tab} />}</div>}
    </aside>
  )
}
