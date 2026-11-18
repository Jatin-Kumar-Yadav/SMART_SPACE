import { Cpu, OctagonX, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectBox, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { ensureHardware, generateHardwareSetup, signatureOf, updateHardware, useIot, type IotTab } from '@/store/iotStore'
import { liveEstop } from '@/store/liveStore'
import { toast } from '@/store/uiStore'
import type { HardwareRunMode } from '@/types'
import { BottomLog } from './BottomLog'
import { CircuitView } from './CircuitView'
import { CodePanel } from './CodePanel'
import { DevicePanel } from './DevicePanel'
import { LiveTab } from './LiveTab'
import { ComponentsPanel, PinsPanel, ValidationPanel } from './PlanPanels'

const TABS: [IotTab, string][] = [['code', 'Code'], ['pins', 'Pin Mapping'], ['components', 'Components'], ['validation', 'Validation'], ['live', 'Live Data']]
const MODES: [HardwareRunMode, string][] = [['simulation', 'Simulation Only'], ['monitor', 'Hardware Monitor'], ['control', 'Hardware Control']]

export function IoTWorkspace() {
  const space = useEditor((s) => s.space)!
  const cfg = space.hardware
  const { plan, ctrl, tab, builtFrom, set } = useIot()
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { ensureHardware() }, [])
  const outdated = !!plan && builtFrom !== signatureOf(space)
  const errors = plan?.issues.filter((i) => i.severity === 'error').length ?? 0
  if (!cfg) return <main className="grid min-w-0 flex-1 place-items-center text-slate-500">Preparing hardware settings…</main>

  return (
    <>
      <DevicePanel />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="IoT hardware workspace">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><Cpu size={15} className="text-blue-600" />IoT Hardware Digital Twin</div>
          <SelectBox className="w-[150px]" value={cfg.controller} onChange={(v) => updateHardware({ controller: v, pinOverrides: {} })} options={[{ value: 'esp32', label: 'ESP32' }, { value: 'uno', label: 'Arduino Uno' }, { value: 'rpi', label: 'Raspberry Pi' }]} />
          <SelectBox className="w-[150px]" value={cfg.tempPart} onChange={(v) => updateHardware({ tempPart: v, pinOverrides: {} })} options={[{ value: 'dht22', label: 'Temp: DHT22' }, { value: 'ds18b20', label: 'Temp: DS18B20' }, { value: 'bme280', label: 'Temp: BME280' }]} />
          <SelectBox className="w-[140px]" value={cfg.lightPart} onChange={(v) => updateHardware({ lightPart: v, pinOverrides: {} })} options={[{ value: 'bh1750', label: 'Light: BH1750' }, { value: 'ldr', label: 'Light: LDR' }]} />
          <SelectBox className="w-[150px]" value={cfg.acOutput ?? 'led'} onChange={(v) => updateHardware({ acOutput: v })} options={[{ value: 'led', label: 'AC: status LED' }, { value: 'blower', label: 'AC: small blower' }, { value: 'both', label: 'AC: LED + blower' }]} />
          <Toggle checked={cfg.includePresence} onChange={(v) => updateHardware({ includePresence: v }, { reposition: true })} label="PIR motion" />
          <div className="ml-auto flex items-center gap-2">
            <div role="radiogroup" aria-label="Run mode" className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {MODES.map(([m, label]) => (
                <button key={m} role="radio" aria-checked={cfg.runMode === m} onClick={() => { updateHardware({ runMode: m }); if (m === 'control') toast('Hardware Control selected. Nothing moves until you arm a controller in Live Data.', 'info') }} className={cn('rounded-md px-2.5 py-1 text-[11.5px] font-medium', cfg.runMode === m ? (m === 'control' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : 'text-slate-600 hover:bg-white')}>{label}</button>
              ))}
            </div>
            <Button variant="danger" className="border-red-400 font-bold" onClick={() => liveEstop()} aria-label="Emergency stop"><OctagonX size={14} />E-STOP</Button>
            <Button onClick={() => { generateHardwareSetup(); set({ tab: 'validation' }); toast('Hardware setup generated', 'success') }}><Wand2 size={14} />Generate Hardware Setup</Button>
          </div>
        </div>
        {outdated && <div className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-[11.5px] text-amber-900">The room or settings changed since the last generation. Press <b>Generate Hardware Setup</b> to refresh the circuit, pins and code.</div>}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {plan && plan.controllers.length > 1 && (
              <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-1.5">{plan.controllers.map((c) => <button key={c.id} onClick={() => set({ ctrl: c.id })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', ctrl === c.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{c.label}</button>)}</div>
            )}
            <div className="min-h-0 flex-1">
              {plan && ctrl ? <CircuitView plan={plan} ctrl={ctrl} selected={selected} onSelect={setSelected} /> : (
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
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Hardware details">
            <div role="tablist" className="flex border-b border-slate-200">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => set({ tab: id })} className={cn('relative flex-1 px-1 py-2 text-[11.5px] font-medium', tab === id ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800')}>
                  {label}{id === 'validation' && errors > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[9.5px] text-white">{errors}</span>}
                  {tab === id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-blue-600" />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'code' && <CodePanel />}
              {tab === 'pins' && <PinsPanel />}
              {tab === 'components' && <ComponentsPanel />}
              {tab === 'validation' && <ValidationPanel />}
              {tab === 'live' && <LiveTab />}
            </div>
          </aside>
        </div>
        <BottomLog />
      </main>
    </>
  )
}
