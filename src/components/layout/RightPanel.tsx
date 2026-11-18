import { Boxes, CalendarClock, SlidersHorizontal, Thermometer, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLayout, type RightTab } from '@/store/layoutStore'
import { PeoplePanel } from '@/components/panels/PeoplePanel'
import { PropertiesPanel } from '@/components/panels/PropertiesPanel'
import { ScenariosPanel } from '@/components/panels/ScenariosPanel'
import { SimulatePanel } from '@/components/panels/SimulatePanel'
import { SpacePanel } from '@/components/panels/SpacePanel'

const TABS: { id: RightTab; label: string; Icon: typeof Boxes }[] = [
  { id: 'properties', label: 'Properties', Icon: SlidersHorizontal },
  { id: 'space', label: 'Space', Icon: Boxes },
  { id: 'people', label: 'People', Icon: Users },
  { id: 'simulate', label: 'Simulate', Icon: Thermometer },
  { id: 'scenarios', label: 'Scenarios', Icon: CalendarClock },
]

export function RightPanel() {
  const tab = useLayout((s) => s.rightTab)
  const set = useLayout((s) => s.set)
  return (
    <aside className="flex h-full w-[330px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Inspector">
      <div className="grid grid-cols-5 border-b border-slate-200">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => set({ rightTab: id })} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium', tab === id ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800')}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      <div className="ss-scroll min-h-0 flex-1">
        {tab === 'properties' && <PropertiesPanel />}
        {tab === 'space' && <SpacePanel />}
        {tab === 'people' && <PeoplePanel />}
        {tab === 'simulate' && <SimulatePanel />}
        {tab === 'scenarios' && <ScenariosPanel />}
      </div>
    </aside>
  )
}
