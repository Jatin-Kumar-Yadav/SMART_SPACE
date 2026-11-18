import { Eye, Flame, Fan, Grid2x2, Lightbulb, Users, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditor, type Layer } from '@/store/editorStore'

const LAYERS: { id: Layer; label: string; Icon: typeof Eye }[] = [
  { id: 'normal', label: '3D view', Icon: Eye },
  { id: 'temperature', label: 'Temperature', Icon: Flame },
  { id: 'lighting', label: 'Lighting', Icon: Lightbulb },
  { id: 'airflow', label: 'Airflow', Icon: Fan },
  { id: 'occupancy', label: 'Occupancy', Icon: Users },
  { id: 'coverage', label: 'Coverage', Icon: ShieldCheck },
  { id: 'zones', label: 'Zones', Icon: Grid2x2 },
]

/** Visualisation layer switcher overlaid on the viewport. */
export function LayerChips() {
  const layer = useEditor((s) => s.layer)
  const set = useEditor((s) => s.set)
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow">
      {LAYERS.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => set({ layer: id })} className={cn('flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] font-medium', layer === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
          <Icon size={13} />{label}
        </button>
      ))}
    </div>
  )
}
