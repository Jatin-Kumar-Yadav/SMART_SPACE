import { OctagonX, Plug, Power, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider, Toggle } from '@/components/ui/controls'
import { Modal } from '@/components/ui/dialog'
import { freshness, type Freshness } from '@/iot/live'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { desiredDuty, liveArm, liveConnect, liveDisconnect, liveEstop, liveSetDuty, useLive } from '@/store/liveStore'
import { useIot } from '@/store/iotStore'
import { Empty } from './CodePanel'

const BADGE: Record<Freshness, string> = {
  simulated: 'bg-slate-200 text-slate-700',
  live: 'bg-green-600 text-white',
  stale: 'bg-amber-500 text-white',
  unavailable: 'bg-red-600 text-white',
}
export const Badge = ({ f }: { f: Freshness }) => <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', BADGE[f])}>{f}</span>

export function LiveTab() {
  const plan = useIot((s) => s.plan)
  const live = useLive()
  const cfg = useEditor((s) => s.space?.hardware)
  const [armFor, setArmFor] = useState<string | null>(null)
  const [ok1, setOk1] = useState(false)
  const [ok2, setOk2] = useState(false)
  if (!plan || !cfg) return <Empty text="Generate the hardware setup first. Live Data maps incoming sensor values and outgoing commands onto it." />
  const mode = cfg.runMode
  const now = live.now || 0
  const connected = live.link === 'connected'
  const sensors = plan.parts.filter((p) => p.sensorId)
  const actuators = plan.parts.filter((p) => p.virtual)

  return (
    <div className="h-full overflow-auto text-[12px]">
      <div className="space-y-2 border-b border-slate-200 px-3 py-2.5">
        <div className={cn('rounded-md border px-2.5 py-1.5', mode === 'control' ? 'border-orange-300 bg-orange-50 text-orange-900' : mode === 'monitor' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-700')}>
          {mode === 'simulation' && <><b>Simulation Only.</b> Nothing is read from or sent to hardware. Every value is tagged <i>simulated</i>.</>}
          {mode === 'monitor' && <><b>Hardware Monitor.</b> Live sensor readings flow into the simulation. No command is ever sent.</>}
          {mode === 'control' && <><b>Hardware Control.</b> The simulation can drive real outputs, but only after you arm a controller. Nothing is switched on automatically.</>}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="password" autoComplete="off" spellCheck={false} aria-label="Backend token" placeholder="Backend token (shown when the backend starts)" value={live.token} onChange={(e) => live.set({ token: e.target.value.trim() })} className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 font-mono text-[11.5px]" />
          {connected || live.link === 'connecting' ? <Button size="sm" variant="secondary" onClick={() => liveDisconnect()}><Unplug size={12} />Disconnect</Button> : <Button size="sm" disabled={mode === 'simulation'} onClick={() => liveConnect()}><Plug size={12} />Connect</Button>}
        </div>
        <p className="text-[11px] text-slate-500">
          Link: <b className={connected ? 'text-green-700' : live.link === 'error' ? 'text-red-700' : 'text-slate-600'}>{live.link}</b>{live.linkDetail ? ` · ${live.linkDetail}` : ''}
          {mode === 'simulation' && ' · choose Hardware Monitor or Hardware Control (top bar) to use the link'}
        </p>
        <p className="text-[10.5px] text-slate-400">The token stays in this tab only (session storage). Run <code>npm run server</code> to start the backend and <code>npm run sim-device</code> to try this without hardware.</p>
      </div>

      <Group title="Try without hardware">
        <div className="px-3 py-2 text-[11px] text-slate-600">
          <p>A <b>simulated</b> controller speaks the same protocol (it proves the app, not your circuit):</p>
          {plan.controllers.slice(0, 1).map((c) => (
            <code key={c.id} className="mt-1 block select-all break-all rounded bg-slate-900 p-1.5 text-[10.5px] text-slate-100">{`npm run sim-device -- --space ${useEditor.getState().space!.id.replace(/[^A-Za-z0-9_-]/g, '_')} --ctrl ${c.id} --token <TOKEN> --actuators ${plan.parts.filter((p) => p.controllerId === c.id && p.virtual).map((p) => `${p.id}:${p.type === 'dcMotor' ? 'motor' : 'led'}`).join(',')} --sensors ${plan.parts.filter((p) => p.controllerId === c.id && p.sensorId).map((p) => `${p.id}:${cfg.sensors.find((s) => s.id === p.sensorId)?.kind}`).join(',')}`}</code>
          ))}
        </div>
      </Group>

      <Group title="Controllers">
        {plan.controllers.map((c) => {
          const s = live.controllers[c.id]
          const f = freshness({ mode, seenAt: s?.seenAt, now, controllerOnline: s?.online, connected })
          return (
            <div key={c.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
              <div className="min-w-0 flex-1"><p className="font-mono text-slate-800">{c.id}</p><p className="text-[10.5px] text-slate-400">{s ? `${s.online ? 'online' : 'offline'}${s.fw ? ` · fw ${s.fw}` : ''}${s.uptime != null ? ` · up ${s.uptime}s` : ''}` : 'no data yet'}</p></div>
              <Badge f={f} />
              {s?.armed ? <span className="rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ARMED</span> : <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">DISARMED</span>}
              {s?.armed ? <Button size="sm" variant="secondary" onClick={() => liveArm(c.id, false)}>Disarm</Button> : <Button size="sm" variant="danger" disabled={mode !== 'control' || !connected || !s?.online} onClick={() => { setOk1(false); setOk2(false); setArmFor(c.id) }}><Power size={12} />Arm…</Button>}
            </div>
          )
        })}
        <div className="px-3 py-2"><Button variant="danger" className="w-full border-red-400 font-bold" onClick={() => liveEstop()}><OctagonX size={14} />EMERGENCY STOP (all outputs to 0)</Button></div>
      </Group>

      <Group title="Sensors">
        {sensors.map((p) => {
          const r = live.readings[p.id]
          const sp = cfg.sensors.find((x) => x.id === p.sensorId)
          const f = freshness({ mode, seenAt: r?.ts, now, error: !!r?.error, controllerOnline: live.controllers[p.controllerId]?.online, connected })
          return (
            <div key={p.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
              <div className="min-w-0 flex-1"><p className="font-mono text-slate-800">{p.id}</p><p className="truncate text-[10.5px] text-slate-400">{sp?.name}</p></div>
              <div className="text-right font-mono text-slate-800">
                {mode === 'simulation' ? '—' : r?.error ? <span className="text-red-700">{r.error}</span> : r ? reading(p.type, r) : '—'}
              </div>
              <Badge f={f} />
            </div>
          )
        })}
        {mode !== 'simulation' && <p className="px-3 py-1.5 text-[10.5px] text-slate-400">Live readings overwrite the simulated temperature of that sensor&apos;s zone, so cooling continues from what was measured. An uncalibrated LDR is shown as a relative level and never injected as lux. A PIR shows motion only; it never changes the seat count.</p>}
      </Group>

      <Group title="Outputs" right={<Toggle checked={live.mirror} onChange={(v) => live.set({ mirror: v })} label="Follow simulation" disabled={mode !== 'control'} />}>
        {actuators.map((p) => {
          const want = desiredDuty(p.id)
          const conf = live.confirmed[p.id]
          const fail = live.failed[p.id]
          const rep = live.reported[p.id]
          const armed = !!live.controllers[p.controllerId]?.armed
          return (
            <div key={p.id} className="border-b border-slate-100 px-3 py-1.5">
              <div className="flex items-start gap-2">
                <div className="w-24 shrink-0"><p className="font-mono text-slate-800">{p.id}</p><p className="truncate text-[10.5px] text-slate-400">{p.virtual?.name}{p.virtual?.variant ? ` · ${p.virtual.variant}` : ''}</p></div>
                <div className="min-w-0 flex-1 text-right text-[11px] text-slate-600">
                  <p>simulation wants <b>{want == null ? '—' : `${Math.round(want * 100)} %`}</b></p>
                  <p>{fail ? <span className="font-medium text-red-700">not applied: {fail.reason}</span> : conf ? <span className="text-green-700">confirmed {Math.round(conf.duty * 100)} %</span> : <span className="text-slate-400">not commanded</span>}{rep ? ` · reported ${Math.round(rep.duty * 100)} %` : ''}</p>
                </div>
              </div>
              {mode === 'control' && !live.mirror && armed && (
                <div className="mt-1 flex items-center gap-2"><span className="w-8 text-[10.5px] text-slate-400">test</span><Slider value={conf?.duty ?? 0} min={0} max={1} step={0.05} onChange={() => undefined} onCommit={(v) => liveSetDuty(p.id, v)} /></div>
              )}
            </div>
          )
        })}
        <p className="px-3 py-1.5 text-[10.5px] text-slate-400">A command only counts as applied after the controller acknowledges it. If the link drops, controllers turn their outputs off on their own when heartbeats stop.</p>
      </Group>

      <Modal open={!!armFor} onOpenChange={(o) => !o && setArmFor(null)} title={`Arm ${armFor ?? ''}?`} description="Arming lets the simulation switch real outputs on this controller.">
        <div className="space-y-3 text-[13px] text-slate-700">
          <label className="flex items-start gap-2"><input type="checkbox" checked={ok1} onChange={(e) => setOk1(e.target.checked)} className="mt-1" />I checked the wiring against the connection guide. Motors are on a separate supply through a MOSFET driver.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={ok2} onChange={(e) => setOk2(e.target.checked)} className="mt-1" />Only low-voltage demonstration loads are connected. <b>No mains voltage.</b></label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setArmFor(null)}>Cancel</Button><Button variant="danger" disabled={!ok1 || !ok2} onClick={() => { if (armFor) liveArm(armFor, true); setArmFor(null) }}>Arm now</Button></div>
        </div>
      </Modal>
    </div>
  )
}

function reading(type: string, r: { value?: number; relative?: number; motion?: boolean; humidity?: number; calibrated?: boolean }) {
  if (r.motion != null && r.value == null) return r.motion ? 'motion' : 'no motion'
  if (type === 'ldr' || r.relative != null) return `${((r.relative ?? 0) * 100).toFixed(0)} % rel.`
  if (type === 'bh1750') return `${r.value} lx`
  return `${r.value?.toFixed(1)} °C${r.humidity != null ? ` · ${r.humidity.toFixed(0)} %` : ''}`
}

function Group({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5"><h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>{right}</div>
      {children}
    </section>
  )
}
