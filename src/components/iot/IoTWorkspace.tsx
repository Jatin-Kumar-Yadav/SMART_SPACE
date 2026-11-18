import { AlertTriangle, Cpu, Download, OctagonX, RefreshCw, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectBox, Toggle } from '@/components/ui/controls'
import { roomDevices } from '@/iot/requirements'
import { makeZip } from '@/iot/zip'
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
import { downloadBlob } from './download'
import { LiveTab } from './LiveTab'
import { ComponentsPanel, PinsPanel, ValidationPanel } from './PlanPanels'

const TABS: [IotTab, string][] = [
  ['code', 'Code'],
  ['components', 'Libraries'],
  ['pins', 'Pin Mapping'],
  ['validation', 'Checks'],
  ['live', 'Live'],
]
const MODES: [HardwareRunMode, string][] = [['simulation', 'Simulation Only'], ['monitor', 'Hardware Monitor'], ['control', 'Hardware Control']]
const WOKWI_FILES = ['sketch.ino', 'diagram.json', 'libraries.txt', 'wokwi.toml', 'README.md'] as const

export function IoTWorkspace() {
  const space = useEditor((s) => s.space)!
  const cfg = space.hardware
  const { plan, ctrl, tab, builtFrom, wokwi, tempThreshold, lightThreshold, set } = useIot()
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    ensureHardware()
    if (space.hardware?.controller === 'rpi') {
      updateHardware({ controller: 'esp32', pinOverrides: {} })
    }
  }, [space.hardware?.controller])
  const outdated = !!plan && builtFrom !== signatureOf(space)
  const errors = plan?.issues.filter((i) => i.severity === 'error').length ?? 0
  if (!cfg) return <main className="grid min-w-0 flex-1 place-items-center text-slate-500">Preparing hardware settings…</main>

  const devs = roomDevices(space, cfg)
  const acCount = devs.filter((d) => d.kind === 'ac').length
  const fanCount = devs.filter((d) => d.kind === 'fan').length
  const lightCount = devs.filter((d) => d.kind === 'light').length
  const sensors = cfg.sensors ?? []
  const tempCount = sensors.filter((s) => s.kind === 'temperature').length
  const lightSensorCount = sensors.filter((s) => s.kind === 'light').length
  const pirCount = sensors.filter((s) => s.kind === 'presence').length

  const handleDownloadWokwi = () => {
    if (!plan) {
      generateHardwareSetup()
    }
    const targetCtrl = ctrl || plan?.controllers[0]?.id
    const wk = targetCtrl ? wokwi[targetCtrl] : null
    if (wk && wk.ok) {
      downloadBlob(
        `wokwi-${targetCtrl}.zip`,
        makeZip(WOKWI_FILES.map((n) => ({ name: n, data: wk.files[n] }))) as BlobPart,
        'application/zip'
      )
      toast('Wokwi project ZIP downloaded successfully. Follow the instructions to run in VS Code.', 'success')
    } else if (wk && !wk.ok) {
      toast(`Cannot export Wokwi project: ${wk.reason}`, 'error')
    } else {
      toast('Hardware plan not ready. Click "Generate Hardware Setup" first.', 'info')
    }
  }

  return (
    <>
      <DevicePanel />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="IoT hardware workspace">
        {/* Primary Settings Toolbar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <Cpu size={15} className="text-blue-600" />IoT Hardware Digital Twin
          </div>
          <SelectBox className="w-[145px]" value={cfg.controller === 'rpi' ? 'esp32' : cfg.controller} onChange={(v) => updateHardware({ controller: v, pinOverrides: {} })} options={[{ value: 'esp32', label: 'ESP32' }, { value: 'uno', label: 'Arduino Uno' }]} />
          <SelectBox className="w-[145px]" value={cfg.tempPart} onChange={(v) => updateHardware({ tempPart: v, pinOverrides: {} })} options={[{ value: 'dht22', label: 'Temp: DHT22' }, { value: 'ds18b20', label: 'Temp: DS18B20' }, { value: 'bme280', label: 'Temp: BME280' }]} />
          <SelectBox className="w-[135px]" value={cfg.lightPart} onChange={(v) => updateHardware({ lightPart: v, pinOverrides: {} })} options={[{ value: 'bh1750', label: 'Light: BH1750' }, { value: 'ldr', label: 'Light: LDR' }]} />
          <SelectBox className="w-[145px]" value={cfg.acOutput ?? 'led'} onChange={(v) => updateHardware({ acOutput: v })} options={[{ value: 'led', label: 'AC: status LED' }, { value: 'blower', label: 'AC: small blower' }, { value: 'both', label: 'AC: LED + blower' }]} />
          <Toggle checked={cfg.includePresence} onChange={(v) => updateHardware({ includePresence: v }, { reposition: true })} label="PIR motion" />
          <div className="ml-auto flex items-center gap-2">
            <div role="radiogroup" aria-label="Run mode" className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {MODES.map(([m, label]) => (
                <button key={m} role="radio" aria-checked={cfg.runMode === m} onClick={() => { updateHardware({ runMode: m }); if (m === 'control') toast('Hardware Control selected. Nothing moves until you arm a controller in Live Data.', 'info') }} className={cn('rounded-md px-2.5 py-1 text-[11.5px] font-medium', cfg.runMode === m ? (m === 'control' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : 'text-slate-600 hover:bg-white')}>{label}</button>
              ))}
            </div>
            <Button variant="danger" className="border-red-400 font-bold" onClick={() => liveEstop()} aria-label="Emergency stop"><OctagonX size={14} />E-STOP</Button>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-100/70 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => { generateHardwareSetup(); set({ tab: 'validation' }); toast('Hardware setup generated', 'success') }}>
              <Wand2 size={13} />Generate Hardware Setup
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { generateHardwareSetup(); toast('Circuit regenerated', 'success') }}>
              <RefreshCw size={13} />Regenerate Circuit
            </Button>
            <Button size="sm" variant="secondary" onClick={handleDownloadWokwi}>
              <Download size={13} />Download Wokwi Project
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-1 border-l border-slate-300 pl-2">
            <span className="text-[11px] text-slate-500 mr-1">Views:</span>
            <Button size="sm" variant={tab === 'components' ? 'default' : 'ghost'} onClick={() => set({ tab: 'components' })}>View Circuit</Button>
            <Button size="sm" variant={tab === 'code' ? 'default' : 'ghost'} onClick={() => set({ tab: 'code' })}>View Firmware</Button>
            <Button size="sm" variant={tab === 'pins' ? 'default' : 'ghost'} onClick={() => set({ tab: 'pins' })}>View Pin Mapping</Button>
          </div>
        </div>

        {/* Compact Hardware Summary Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
          <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Hardware Summary:</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 border border-slate-200 font-mono text-[11px]">Board: <b>{cfg.controller.toUpperCase()}</b></span>
          <span className="rounded bg-blue-50 px-2 py-0.5 border border-blue-200 text-blue-800 text-[11px]">AC: <b>{acCount}</b></span>
          <span className="rounded bg-sky-50 px-2 py-0.5 border border-sky-200 text-sky-800 text-[11px]">Fans: <b>{fanCount}</b></span>
          <span className="rounded bg-amber-50 px-2 py-0.5 border border-amber-200 text-amber-800 text-[11px]">Lights: <b>{lightCount}</b></span>
          <span className="rounded bg-red-50 px-2 py-0.5 border border-red-200 text-red-800 text-[11px]">Temp Sensors: <b>{tempCount}</b></span>
          <span className="rounded bg-yellow-50 px-2 py-0.5 border border-yellow-200 text-yellow-800 text-[11px]">Light Sensors: <b>{lightSensorCount}</b></span>
          <span className="rounded bg-green-50 px-2 py-0.5 border border-green-200 text-green-800 text-[11px]">PIR Sensors: <b>{pirCount}</b></span>

          {/* Configurable Simulation Thresholds */}
          <div className="ml-auto flex items-center gap-2.5 text-[11px] text-slate-600">
            <label className="flex items-center gap-1 font-medium">
              Temp Threshold:
              <input
                type="number"
                value={tempThreshold}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 24
                  set({ tempThreshold: v })
                  generateHardwareSetup()
                }}
                className="w-13 rounded border border-slate-300 px-1 py-0.5 text-slate-800 bg-white text-center font-mono"
                step="0.5"
              />
              °C
            </label>
            <label className="flex items-center gap-1 font-medium">
              Light Threshold:
              <input
                type="number"
                value={lightThreshold}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10) || 400
                  set({ lightThreshold: v })
                  generateHardwareSetup()
                }}
                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-slate-800 bg-white text-center font-mono"
                step="50"
              />
              lx
            </label>
          </div>
        </div>

        {/* Validation / Status Banners */}
        {outdated && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-900 flex items-center justify-between">
            <span>The room or settings changed since the last generation. Press <b>Regenerate Circuit</b> to refresh the circuit, pins and code.</span>
            <Button size="sm" variant="secondary" onClick={() => generateHardwareSetup()}>Regenerate now</Button>
          </div>
        )}
        {errors > 0 && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11.5px] text-red-900 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} className="text-red-600" />
              Hardware Validation Alert: {errors} critical issue{errors > 1 ? 's' : ''} detected (e.g. GPIO limits or pin conflicts).
            </span>
            <button onClick={() => set({ tab: 'validation' })} className="font-semibold underline hover:text-red-950 text-xs">
              View in Validation Tab
            </button>
          </div>
        )}

        {/* Workspace Canvas & Panels */}
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
          <aside className="flex w-[410px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Hardware details">
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
