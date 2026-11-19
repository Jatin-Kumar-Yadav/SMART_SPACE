import { Box, Cpu, Layers, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { ensureHardware, generateHardwareSetup, updateHardware, useIot, type IotTab } from '@/store/iotStore'
import { toast } from '@/store/uiStore'
import { CircuitView } from './CircuitView'
import { CodePanel } from './CodePanel'
import { DevicePanel } from './DevicePanel'
import { Hardware3DView } from './Hardware3DView'
import { PinsPanel } from './PlanPanels'

const TABS: [IotTab, string][] = [
  ['code', 'Code'],
  ['pins', 'Pin Mapping'],
]

export function IoTWorkspace() {
  const space = useEditor((s) => s.space)!
  const cfg = space.hardware
  const { plan, ctrl, tab, set } = useIot()
  const [selected, setSelected] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d')
  const [wireFilter, setWireFilter] = useState<'all' | 'inputs' | 'outputs'>('all')
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    ensureHardware()
    if (space.hardware?.controller === 'rpi') {
      updateHardware({ controller: 'esp32', pinOverrides: {} })
    }
  }, [space.hardware?.controller])
  if (!cfg) return <main className="grid min-w-0 flex-1 place-items-center text-slate-500">Preparing hardware settings…</main>

  return (
    <>
      {setupOpen && <DevicePanel />}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="IoT hardware workspace">
        {/* Main IoT Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white px-3 py-2 text-xs">
          {/* Generate Hardware Setup Button */}
          <Button
            size="sm"
            onClick={() => {
              generateHardwareSetup()
              toast('Hardware setup generated', 'success')
            }}
          >
            Generate Hardware Setup
          </Button>

          {/* Filter Chips: All | Inputs | Outputs */}
          <div className="flex items-center gap-1 border-l border-slate-200 pl-2.5">
            {(['all', 'inputs', 'outputs'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setWireFilter(f)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition',
                  wireFilter === f
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                )}
              >
                {f === 'all' ? 'All' : f === 'inputs' ? 'Inputs' : 'Outputs'}
              </button>
            ))}
          </div>

          {/* 2D / 3D Segmented Toggle */}
          <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white" role="group" aria-label="View Mode">
            <button
              type="button"
              onClick={() => setViewMode('2d')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition',
                viewMode === '2d' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <Layers size={13} />2D
            </button>
            <button
              type="button"
              onClick={() => setViewMode('3d')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition',
                viewMode === '3d' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <Box size={13} />3D
            </button>
          </div>

          {/* Right Toolbar Actions: Setup Drawer */}
          <div className="ml-auto flex items-center gap-2.5">
            <Button
              size="sm"
              variant={setupOpen ? 'default' : 'secondary'}
              onClick={() => setSetupOpen(!setupOpen)}
            >
              <Settings size={13} />Setup
            </Button>
          </div>
        </div>

        {/* Workspace Canvas & Panels */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {plan && plan.controllers.length > 1 && (
              <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-1.5">{plan.controllers.map((c) => <button key={c.id} onClick={() => set({ ctrl: c.id })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', ctrl === c.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{c.label}</button>)}</div>
            )}
            <div className="min-h-0 flex-1">
              {viewMode === '3d' ? (
                <Hardware3DView plan={plan} ctrl={ctrl} wireFilter={wireFilter} />
              ) : plan && ctrl ? (
                <CircuitView plan={plan} ctrl={ctrl} selected={selected} onSelect={setSelected} />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-slate-500">
                  <div className="max-w-md space-y-2">
                    <Cpu className="mx-auto text-slate-300" size={40} />
                    <p className="text-[14px] font-medium text-slate-700">{plan && !plan.controllers.length ? 'No controller could be planned' : 'No circuit yet'}</p>
                    <p className="text-[12.5px]">{plan?.reasons[0] ?? 'Choose a controller and sensors, then press Generate Hardware Setup. The app maps every fan, AC and light of this room to a hardware output, picks pins, and checks them.'}</p>
                    <p className="text-[11.5px] text-slate-400">Fans use a small DC motor behind a MOSFET driver. AC is a status LED or small blower. Lights are PWM LEDs. Nothing connects to mains.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside className="flex w-[410px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Hardware details">
            <div role="tablist" className="flex border-b border-slate-200">
              {TABS.map(([id, label]) => {
                const active = (tab === id) || (tab !== 'pins' && id === 'code')
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => set({ tab: id })}
                    className={cn(
                      'relative flex-1 px-1 py-2 text-[11.5px] font-medium transition',
                      active ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800'
                    )}
                  >
                    {label}
                    {active && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-blue-600" />}
                  </button>
                )
              })}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'pins' ? <PinsPanel /> : <CodePanel />}
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
