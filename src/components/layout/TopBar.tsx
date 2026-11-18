import { ArrowLeft, Box, Cloud, CloudOff, Home, Maximize, Redo2, RotateCcw, Save, Settings, Square, Undo2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { saveNow } from '@/hooks/useSpaceLifecycle'
import { navigate } from '@/hooks/useHashRoute'
import { useEditor } from '@/store/editorStore'
import { useLayout } from '@/store/layoutStore'

function SaveBadge() {
  const s = useEditor((st) => st.saveStatus)
  const map = {
    saved: { Icon: Cloud, text: 'Saved', cls: 'text-emerald-700 bg-emerald-50' },
    saving: { Icon: Loader2, text: 'Saving…', cls: 'text-blue-700 bg-blue-50' },
    unsaved: { Icon: CloudOff, text: 'Unsaved changes', cls: 'text-amber-700 bg-amber-50' },
  }[s]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', map.cls)} role="status"><map.Icon size={12} className={s === 'saving' ? 'animate-spin' : ''} />{map.text}</span>
}

function Icon({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <Tip label={label}><Button variant={active ? 'active' : 'ghost'} size="icon" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active}>{children}</Button></Tip>
}

export function TopBar() {
  const name = useEditor((s) => s.space!.name)
  const rename = useEditor((s) => s.renameSpace)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const viewMode = useEditor((s) => s.viewMode)
  const set = useEditor((s) => s.set)
  const camera = useEditor((s) => s.camera)
  const layout = useLayout((s) => s.set)
  const mode = useLayout((s) => s.mode)
  const setView = (v: '2d' | '3d') => {
    set({ viewMode: v })
    camera(v === '2d' ? 'top' : 'iso')
  }
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2">
      <Tip label="Back to My Spaces"><Button variant="ghost" size="icon" aria-label="Back to My Spaces" onClick={() => { void saveNow({ thumbnail: true }); navigate({ kind: 'dashboard' }) }}><ArrowLeft size={16} /></Button></Tip>
      <div className="flex items-center gap-2 pl-1 pr-3">
        <Home size={15} className="text-blue-600" />
        <TextInput value={name} maxLength={60} className="h-8 w-52 border-transparent bg-transparent font-semibold hover:border-slate-200" onCommit={(v) => v.trim() && rename(v.trim())} />
        <SaveBadge />
      </div>
      <Tip label="Save now (Ctrl+S)"><Button size="sm" onClick={() => void saveNow({ thumbnail: true })}><Save size={13} />Save</Button></Tip>
      <div className="mx-1 h-5 w-px bg-slate-200" />
      <Icon label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Undo2 size={15} /></Icon>
      <Icon label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}><Redo2 size={15} /></Icon>
      <div className="mx-1 h-5 w-px bg-slate-200" />
      {mode === 'simulation' && (
        <>
      <div className="flex overflow-hidden rounded-md border border-slate-200" role="group" aria-label="View mode">
        {(['3d', '2d'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cn('h-8 px-3 text-[12px] font-semibold uppercase', viewMode === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>{v}</button>)}
      </div>
      <div className="mx-1 h-5 w-px bg-slate-200" />
      <Icon label="Fit room (F)" onClick={() => camera('fit')}><Maximize size={15} /></Icon>
      <Icon label="Isometric view" onClick={() => { set({ viewMode: '3d' }); camera('iso') }}><Box size={15} /></Icon>
      <Icon label="Top view" onClick={() => camera('top')}><Square size={15} /></Icon>
      <Icon label="Reset camera" onClick={() => camera('reset')}><RotateCcw size={15} /></Icon>
        </>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Icon label="Settings" onClick={() => layout({ rightTab: 'space', rightOpen: true })}><Settings size={15} /></Icon>
      </div>
    </header>
  )
}
