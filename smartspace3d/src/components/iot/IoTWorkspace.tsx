import { Box, CheckCircle2, Cpu, Pause, Play, Settings2, Square, Wand2, Workflow, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { commandedDuty, sampleSensor } from '@/iot/simbridge'
import { useEditor } from '@/store/editorStore'
import { ensureHardware, generateHardwareSetup, signatureOf, useIot, type IotFilter, type IotTab } from '@/store/iotStore'
import { useLive } from '@/store/liveStore'
import { useLayout } from '@/store/layoutStore'
import { simPause, simResume, simStart, simStop, useSim } from '@/store/simStore'
import { toast } from '@/store/uiStore'
import { BottomLog } from './BottomLog'
import { CircuitView } from './CircuitView'
import { CodePanel, LibrariesPanel } from './CodePanel'
import { DevicePanel } from './DevicePanel'
import { Hardware3D } from './Hardware3D'
import { LiveTab } from './LiveTab'
import { ComponentsPanel, PinsPanel, ValidationPanel } from './PlanPanels'
import { SensorPopover } from './SensorPopover'
import type { ArtState } from './art'

const TABS: [IotTab, string][] = [['code', 'Code'], ['libraries', 'Libraries'], ['pins', 'Pin Mapping'], ['validation', 'Checks'], ['live', 'Live']]
const FILTERS: [IotFilter, string][] = [['all', 'All'], ['inputs', 'Inputs'], ['outputs', 'Outputs']]

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string, React.ReactNode?][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map(([v, text, icon]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium', value === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white')}>{icon}{text}</button>
      ))}
    </div>
  )
}

export function IoTWorkspace() {
  const space = useEditor((s) => s.space)!
  const cfg = space.hardware
  const { plan, ctrl, tab, builtFrom, filter, view, selected, set, sensorSource, injected } = useIot()
  const confirmed = useLive((s) => s.confirmed)
  const readings = useLive((s) => s.readings)
  const linkUp = useLive((s) => s.link === 'connected')
  const status = useSim((s) => s.status)
  const snap = useSim((s) => s.snapshot)
  const [setup, setSetup] = useState(false)
  const [pop, setPop] = useState<{ id: string; x: number; y: number } | null>(null)

  useEffect(() => { ensureHardware() }, [])
  // the circuit is the centre of this workspace: fold the object library while it is open
  useEffect(() => {
    const was = useLayout.getState().libraryOpen
    useLayout.setState({ libraryOpen: false })
    return () => useLayout.setState({ libraryOpen: was })
  }, [])

  const outdated = !!plan && builtFrom !== signatureOf(space)
  const errors = plan?.issues.filter((i) => i.severity === 'error').length ?? 0
  const running = status === 'running'

  const art = useMemo(() => {
    const out: Record<string, ArtState> = {}
    if (!plan) return out
    for (const p of plan.parts) {
      const sp = p.sensorId ? cfg?.sensors.find((s) => s.id === p.sensorId) : undefined
      if (sp) {
        const unit = sp.kind === 'temperature' ? '°C' : 'lx'
        const digits = sp.kind === 'temperature' ? 1 : 0
        if (sensorSource[p.id] === 'live') {
          const hw = readings[p.id]
          out[p.id] = hw && hw.value != null ? { reading: `${hw.value.toFixed(digits)} ${unit}`, note: 'live hardware' } : { reading: '—', note: 'live hardware: no data' }
        } else if (snap) {
          const r = sampleSensor(snap, space, sp)
          const inj = injected[sp.id]
          if (r) out[p.id] = { reading: `${r.value.toFixed(digits)} ${r.unit}`, note: inj && Date.now() - inj.at < 20000 ? `you set ${inj.value.toFixed(digits)}` : 'simulated' }
        }
      } else if (p.virtual) {
        const ack = linkUp ? confirmed[p.id] : undefined
        out[p.id] = ack ? { duty: ack.duty, note: 'acknowledged by hardware' } : { duty: commandedDuty(snap, space, p) ?? 0, note: 'commanded by simulation' }
      }
    }
    return out
  }, [plan, snap, space, cfg, sensorSource, injected, readings, confirmed, linkUp])

  if (!cfg) return <main className="grid min-w-0 flex-1 place-items-center text-slate-500">Preparing hardware settings…</main>

  const generate = () => { generateHardwareSetup(); toast('Hardware setup generated', 'success') }
  const play = () => { if (status === 'paused') simResume(); else simStart() }
  const roleOf = (id: string) => plan?.controllers.find((c) => c.id === id)?.role

  return (
    <>
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="IoT hardware workspace">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-slate-200 bg-white px-3 py-2" data-testid="iot-toolbar">
          <Button onClick={generate} data-testid="generate"><Wand2 size={14} />Generate Hardware Setup</Button>
          <Segmented label="Show" value={filter} onChange={(v) => set({ filter: v })} options={FILTERS} />
          <Segmented label="View" value={view} onChange={(v) => set({ view: v })} options={[['2d', '2D', <Workflow key="a" size={12} />], ['3d', '3D', <Box key="b" size={12} />]]} />
          <div className="flex items-center gap-1" role="group" aria-label="Simulation">
            <Button size="sm" variant={running ? 'secondary' : 'default'} aria-label="Run" data-testid="run" onClick={play} disabled={running}><Play size={13} />Run</Button>
            <Button size="sm" variant="secondary" aria-label="Pause" data-testid="pause" onClick={() => simPause()} disabled={!running}><Pause size={13} />Pause</Button>
            <Button size="sm" variant="secondary" aria-label="Stop" data-testid="stop" onClick={() => simStop()} disabled={status === 'stopped'}><Square size={12} />Stop</Button>
          </div>
          <span className="text-[11.5px] text-slate-500" data-testid="run-status">{running ? 'Simulation running' : status === 'paused' ? 'Paused' : 'Stopped'}</span>
          <div className="ml-auto flex items-center gap-2">
            {plan && (errors > 0
              ? <span className="flex items-center gap-1 text-[12px] font-medium text-red-700" data-testid="ready-badge"><XCircle size={14} />{errors} problem{errors > 1 ? 's' : ''}: not ready</span>
              : <span className="flex items-center gap-1 text-[12px] font-medium text-green-700" data-testid="ready-badge"><CheckCircle2 size={14} />Validated</span>)}
            <Button size="sm" variant="secondary" onClick={() => setSetup((v) => !v)} aria-pressed={setup} data-testid="setup-toggle"><Settings2 size={13} />Setup</Button>
          </div>
        </div>
        {outdated && <div className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-[11.5px] text-amber-900">The room or settings changed since the last generation. Press <b>Generate Hardware Setup</b> to refresh.</div>}
        <div className="relative flex min-h-0 flex-1">
          {setup && <DevicePanel />}
          <div className="flex min-w-0 flex-1 flex-col" data-testid="circuit-area">
            {plan && plan.controllers.length > 1 && (
              <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-1.5">{plan.controllers.map((c) => <button key={c.id} onClick={() => set({ ctrl: c.id })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', ctrl === c.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{c.label} <span className="opacity-70">· {c.role}</span></button>)}</div>
            )}
            <div className="min-h-0 flex-1">
              {plan && ctrl ? (
                view === '2d'
                  ? <CircuitView plan={plan} ctrl={ctrl} filter={filter} selected={selected} onSelect={(id) => set({ selected: id })} art={art} running={running} onSensor={(id, at) => { const part = plan.parts.find((p) => p.id === id); if (part?.sensorId && cfg.sensors.find((s) => s.id === part.sensorId)?.kind !== 'presence') setPop({ id, ...at }) }} />
                  : <Hardware3D plan={plan} space={space} filter={filter} selected={selected} onSelect={(id) => set({ selected: id })} art={art} running={running} />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-slate-500">
                  <div className="max-w-md space-y-2">
                    <Cpu className="mx-auto text-slate-300" size={40} />
                    <p className="text-[14px] font-medium text-slate-700">{plan && !plan.controllers.length ? 'No controller could be planned' : 'No circuit yet'}</p>
                    <p className="text-[12.5px]">{plan?.reasons[0] ?? 'Press Generate Hardware Setup. The app reads this room, adds sensors per zone and one output per fan, AC unit and light, picks pins, wires them and checks the result.'}</p>
                    <p className="text-[11.5px] text-slate-400">Fans: small DC motor behind a MOSFET driver. AC: status LED or small blower. Lights: PWM LEDs. Nothing connects to mains.</p>
                  </div>
                </div>
              )}
            </div>
            {plan && ctrl && roleOf(ctrl) && roleOf(ctrl) !== 'standalone' && <p className="border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">{roleOf(ctrl) === 'master' ? 'Master: gateway controller. Nodes publish to the same MQTT broker.' : 'Node: serves its own zones and reports to the same MQTT broker as the master.'} Wokwi simulates one controller per project.</p>}
          </div>
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Hardware details" data-testid="iot-right">
            <div role="tablist" className="flex border-b border-slate-200">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => set({ tab: id })} className={cn('relative flex-1 px-1 py-2 text-[11.5px] font-medium', tab === id ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800')}>
                  {label}{id === 'validation' && errors > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[9.5px] text-white">{errors}</span>}
                  {tab === id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-blue-600" />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {tab === 'code' && <CodePanel />}
              {tab === 'libraries' && <div className="h-full overflow-auto"><LibrariesPanel /><ComponentsPanel /></div>}
              {tab === 'pins' && <PinsPanel />}
              {tab === 'validation' && <ValidationPanel />}
              {tab === 'live' && <LiveTab />}
            </div>
          </aside>
        </div>
        <BottomLog />
      </main>
      {pop && <SensorPopover partId={pop.id} at={pop} onClose={() => setPop(null)} />}
    </>
  )
}
