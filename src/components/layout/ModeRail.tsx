import { Box, Cpu, PanelLeftClose, PanelLeftOpen, Video } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLayout, type AppMode } from '@/store/layoutStore'

const MODES: { id: AppMode; label: string; Icon: typeof Box }[] = [
  { id: 'simulation', label: 'Virtual Simulation', Icon: Box },
  { id: 'camera', label: 'Live Camera Digital Twin', Icon: Video },
  { id: 'iot', label: 'IoT Hardware Integration', Icon: Cpu },
]

/**
 * Slim vertical mode switcher between the object library and the workspace.
 * Icons only (names live in tooltips). Switching changes the view, never the project.
 */
export function ModeRail() {
  const mode = useLayout((s) => s.mode)
  const libraryOpen = useLayout((s) => s.libraryOpen)
  const set = useLayout((s) => s.set)
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-slate-50 py-3" aria-label="Application mode">
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        {MODES.map(({ id, label, Icon }) => (
          <Tip key={id} label={label} side="right">
            <button
              role="tab"
              aria-selected={mode === id}
              aria-label={label}
              data-mode={id}
              onClick={() => set({ mode: id })}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
                mode === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
              )}
            >
              <Icon size={17} />
            </button>
          </Tip>
        ))}
      </div>
      <div className="mt-auto">
        <Tip label={libraryOpen ? 'Hide object library' : 'Show object library'} side="right">
          <button
            aria-label={libraryOpen ? 'Hide object library' : 'Show object library'}
            onClick={() => set({ libraryOpen: !libraryOpen })}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            {libraryOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </Tip>
      </div>
    </nav>
  )
}
