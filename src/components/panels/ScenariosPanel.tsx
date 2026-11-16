import { Copy, Play, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section, TextInput } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { activeScenario, useEditor } from '@/store/editorStore'
import { simStart, simStop } from '@/store/simStore'
import { toast } from '@/store/uiStore'

export function ScenariosPanel() {
  const space = useEditor((s) => s.space!)
  const active = activeScenario(space)
  const add = useEditor((s) => s.addScenario)
  const remove = useEditor((s) => s.removeScenario)
  const setActive = useEditor((s) => s.setActiveScenario)
  const update = useEditor((s) => s.updateScenario)
  const capture = useEditor((s) => s.captureScenarioStates)
  return (
    <>
      <Section title="Scenarios" right={<Button size="sm" onClick={() => add()}><Plus size={12} />New</Button>}>
        <p className="text-[11px] leading-snug text-slate-500">A scenario stores occupancy, initial / target conditions, device and window states, lighting and simulation settings. The room layout is never changed by switching scenarios.</p>
        <div className="flex flex-col gap-1.5">
          {space.scenarios.map((s) => (
            <div key={s.id} className={cn('rounded-lg border p-2', s.id === active.id ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200')}>
              {s.id === active.id ? (
                <TextInput value={s.name} onCommit={(name) => name.trim() && update(s.id, { name: name.trim() })} />
              ) : (
                <button className="w-full text-left text-[13px] font-medium text-slate-800 hover:text-blue-700" onClick={() => { simStop(); setActive(s.id) }}>{s.name}</button>
              )}
              <div className="mt-1 text-[11px] text-slate-500">{s.occupants.length} people · {s.initialTempC}→{s.targetTempC} °C · {s.targetLux} lx</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={`Active: ${active.name}`}>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="default" size="sm" onClick={() => { simStop(); simStart() }}><Play size={12} />Run scenario</Button>
          <Button size="sm" onClick={() => add(undefined, active.id)}><Copy size={12} />Duplicate</Button>
          <Button size="sm" onClick={() => { capture(); toast('Current device and window states saved into this scenario', 'success') }}><Save size={12} />Save device states</Button>
          <Button size="sm" variant="danger" onClick={() => remove(active.id)}><Trash2 size={12} />Delete</Button>
        </div>
      </Section>
    </>
  )
}
