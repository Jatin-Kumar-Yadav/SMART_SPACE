import { Cpu, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CATALOG_LIST, type CatalogEntry } from '@/objects/catalog'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { useLayout, type LeftTab } from '@/store/layoutStore'
import { kindIcons } from '@/three/thumbnails'

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
]

const HIDDEN_KINDS = new Set([
  'diningTable',
  'coffeeTable',
  'sofa',
  'bed',
  'cabinet',
  'wardrobe',
  'bookshelf',
  'podium',
  'plant',
  'carpet',
  'column',
])

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
    return CATALOG_LIST.filter(
      (e) =>
        e.category === cat &&
        !HIDDEN_KINDS.has(e.kind) &&
        (!needle || e.label.toLowerCase().includes(needle) || e.tags.some((t) => t.includes(needle))),
    )
  }, [tab, q])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative m-3 mb-2">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search objects…" className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
      </div>
      <div className="ss-scroll min-h-0 flex-1 px-3 pb-3">
        {tab === 'environment' && <p className="mb-2 text-[11px] leading-snug text-slate-500">Environmental devices are drawn with a teal tag. Select one to see and drag its influence region.</p>}
        <div className="grid grid-cols-2 gap-2">{items.map((e) => <Item key={e.kind} e={e} icon={icons[e.kind]} />)}</div>
        {!items.length && <p className="py-6 text-center text-xs text-slate-400">No objects match “{q}”.</p>}
      </div>
    </div>
  )
}

export function LibraryPanel() {
  const tab = useLayout((s) => s.leftTab)
  const open = useLayout((s) => s.libraryOpen)
  const set = useLayout((s) => s.set)
  if (!open) return null
  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-slate-200 bg-white" aria-label="Object library">
      <div className="grid grid-cols-3 border-b border-slate-200 text-[11px]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => set({ leftTab: t.id })} className={cn('px-1 py-2.5 font-medium', tab === t.id ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800')}>{t.label}</button>
        ))}
      </div>
      <ObjectGrid tab={tab === 'materials' ? 'furniture' : tab} />
    </aside>
  )
}
