import { Box, Copy, Download, FolderOpen, Home, Pencil, Plus, Sparkles, Trash2, Upload, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/controls'
import { Modal } from '@/components/ui/dialog'
import { exportProject, importProject, parseProject, serializeProject } from '@/database/projectIO'
import { getRepository } from '@/database/repository'
import { DEMO_SPACE_ID, createSeminarHall } from '@/demo/seminarHall'
import { navigate } from '@/hooks/useHashRoute'
import { toast } from '@/store/uiStore'
import { renderSpaceThumbnail } from '@/three/thumbnails'
import type { SpaceSummary } from '@/types'
import { downloadText, SPACE_TYPES } from '@/components/panels/SpacePanel'
import { CreateSpaceDialog } from './CreateSpaceDialog'

const SEEDED = 'smartspace3d.demoSeeded'

/** Create (or restore) the Seminar Hall demo project. */
export async function installDemo() {
  const demo = { ...createSeminarHall(), id: DEMO_SPACE_ID }
  try {
    demo.thumbnail = renderSpaceThumbnail(demo)
  } catch (e) {
    console.warn('demo thumbnail failed', e)
  }
  await getRepository().save(demo)
  return demo
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(t).toLocaleDateString()
}

export function Dashboard() {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<SpaceSummary | null>(null)
  const [deleting, setDeleting] = useState<SpaceSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const repo = getRepository()

  const reload = useCallback(async () => setSpaces(await repo.list()), [repo])
  useEffect(() => {
    void (async () => {
      let list = await repo.list()
      let seeded = false
      try {
        seeded = localStorage.getItem(SEEDED) === '1'
      } catch { /* storage blocked */ }
      if (!list.length && !seeded) {
        await installDemo()
        try {
          localStorage.setItem(SEEDED, '1')
        } catch { /* ignore */ }
        list = await repo.list()
      }
      setSpaces(list)
    })()
  }, [repo])

  const hasDemo = spaces?.some((s) => s.id === DEMO_SPACE_ID)

  return (
    <div className="ss-scroll h-full bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-blue-600"><Home size={18} /><span className="text-[12px] font-semibold uppercase tracking-widest">SmartSpace 3D</span></div>
            <h1 className="text-2xl font-semibold text-slate-900">My Spaces</h1>
            <p className="mt-1 max-w-xl text-[13px] text-slate-500">Build a 3D interior from real dimensions, add furniture, fans, AC and lights, seat people, then simulate temperature and lighting with automatic control.</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const s = await importProject(parseProject(await f.text()), repo)
                toast(`Imported “${s.name}”`, 'success')
                void reload()
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Import failed', 'error')
              }
            }} />
            <Button onClick={() => fileRef.current?.click()}><Upload size={14} />Import project</Button>
            {!hasDemo && <Button onClick={async () => { await installDemo(); toast('Seminar Hall demo restored', 'success'); void reload() }}><Sparkles size={14} />Add demo</Button>}
            <Button variant="default" onClick={() => setCreating(true)}><Plus size={14} />Create space</Button>
          </div>
        </header>

        {spaces === null ? (
          <div className="py-20 text-center text-slate-400">Loading…</div>
        ) : spaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
            <Box className="mx-auto mb-3 text-slate-300" size={40} />
            <h2 className="text-base font-semibold text-slate-800">No spaces yet</h2>
            <p className="mb-4 text-[13px] text-slate-500">Create your first space or open the ready-made Seminar Hall.</p>
            <div className="flex justify-center gap-2"><Button variant="default" onClick={() => setCreating(true)}><Plus size={14} />Create space</Button><Button onClick={async () => { await installDemo(); void reload() }}><Sparkles size={14} />Add demo</Button></div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <article key={s.id} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg">
                <button className="block aspect-[8/5] w-full bg-slate-200" onClick={() => navigate({ kind: 'editor', id: s.id })} aria-label={`Open ${s.name}`}>
                  {s.thumbnail ? <img src={s.thumbnail} alt={`${s.name} preview`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-slate-400"><Box size={36} /></div>}
                </button>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-semibold text-slate-900">{s.name}</h2>
                      <p className="text-[12px] text-slate-500">{SPACE_TYPES.find((t) => t.value === s.type)?.label} · {s.dims.length} × {s.dims.width} × {s.dims.height} m</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-slate-600">
                    <span>{s.objectCount} objects</span><span className="flex items-center gap-1"><Users size={12} />{s.seatCapacity} seats</span><span className="ml-auto text-slate-400">{ago(s.updatedAt)}</span>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    <Button variant="default" size="sm" onClick={() => navigate({ kind: 'editor', id: s.id })}><FolderOpen size={13} />Open</Button>
                    <Button size="iconSm" title="Rename" aria-label="Rename" onClick={() => setRenaming(s)}><Pencil size={13} /></Button>
                    <Button size="iconSm" title="Duplicate" aria-label="Duplicate" onClick={async () => { await repo.duplicate(s.id); toast('Space duplicated', 'success'); void reload() }}><Copy size={13} /></Button>
                    <Button size="iconSm" title="Export JSON" aria-label="Export" onClick={async () => { const sp = await repo.get(s.id); if (sp) downloadText(`${sp.name.replace(/[^\w-]+/g, '_')}.smartspace.json`, serializeProject(await exportProject(sp, repo))) }}><Download size={13} /></Button>
                    <Button size="iconSm" variant="danger" className="ml-auto" title="Delete" aria-label="Delete" onClick={() => setDeleting(s)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
      <Modal open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="Rename space" width="max-w-sm">
        {renaming && <TextInput value={renaming.name} maxLength={60} autoFocus onCommit={async (v) => { if (v.trim()) { await repo.rename(renaming.id, v.trim()); setRenaming(null); void reload() } }} />}
        <p className="mt-2 text-[11px] text-slate-400">Press Enter to confirm.</p>
      </Modal>
      <Modal open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete space?" description={deleting ? `“${deleting.name}” and all of its scenarios will be removed from this browser.` : ''} width="max-w-sm">
        <div className="flex justify-end gap-2"><Button onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={async () => { if (deleting) { await repo.remove(deleting.id); setDeleting(null); toast('Space deleted', 'info'); void reload() } }}>Delete</Button></div>
      </Modal>
    </div>
  )
}
