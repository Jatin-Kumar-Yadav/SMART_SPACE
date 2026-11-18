import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SimCharts } from '@/components/charts/SimCharts'
import { SimControls } from '@/components/simulation/SimControls'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/simulation/analytic'
import { setDevice } from '@/store/actions'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useLayout, type BottomTab } from '@/store/layoutStore'
import { useSim } from '@/store/simStore'
import { CoolingTab } from './CoolingTab'

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'devices', label: 'Devices' },
  { id: 'zones', label: 'Zones' },
  { id: 'cooling', label: 'Cooling' },
]

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="min-w-[188px] max-w-[260px] shrink-0 basis-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid="metric-card">
      <div className="whitespace-nowrap text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn('text-lg font-semibold leading-tight text-slate-900', tone === 'ok' && 'text-emerald-700', tone === 'warn' && 'text-amber-700')}>{value}</div>
      {sub && <div className="line-clamp-2 text-[10.5px] leading-snug text-slate-400">{sub}</div>}
    </div>
  )
}

/**
 * The nine overview cards in ONE horizontally scrolling row (trackpad, Shift + wheel, scrollbar, arrow buttons).
 * "Occupied zones", "Uniformity" and "Sim time" are hidden here only: the engine still computes them
 * (snapshot.stats.comfort, stats.time) and the Zones / Charts tabs still use them.
 */
function Overview() {
  const snap = useSim((s) => s.snapshot)
  const sc = useEditor((s) => activeScenario(s.space!))
  const row = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const measure = () => {
    const el = row.current
    if (el) setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }
  useEffect(() => {
    measure()
    const el = row.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  })
  if (!snap) return null
  const st = snap.stats
  const fans = snap.devices.filter((d) => d.type === 'fan')
  const acs = snap.devices.filter((d) => d.type === 'ac')
  const est = st.estimate
  const by = (dx: number) => row.current?.scrollBy({ left: dx, behavior: 'smooth' })
  return (
    <div className="relative">
      <div ref={row} onScroll={measure} data-testid="metric-row" className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-1.5" tabIndex={0} aria-label="Simulation metrics">
        <Tile label="Room temperature" value={`${st.avgT.toFixed(1)} °C`} sub={`min ${st.minT.toFixed(1)} · max ${st.maxT.toFixed(1)}`} tone={st.comfort.averageTargetReached ? 'ok' : undefined} />
        <Tile label="Target" value={`${sc.targetTempC} °C`} sub={`±${sc.sim.toleranceC} °C · outside ${sc.outsideTempC} °C`} />
        <Tile label="Occupancy" value={`${st.occupants}`} sub={`${Math.round(st.occupantHeatW)} W body heat`} />
        <Tile label="Lighting" value={`${Math.round(st.occLux)} lx`} sub={`${st.occupants ? 'at seats' : 'room avg'} · target ${sc.targetLux} lx · room avg ${Math.round(st.avgLux)} · outdoor ${Math.round(st.outdoorLux).toLocaleString()}`} />
        <Tile label="Active fans" value={`${fans.filter((f) => f.level > 0).length} / ${fans.length}`} sub={`${Math.round(st.fanW)} W`} />
        <Tile label="Active AC units" value={`${acs.filter((f) => f.level > 0).length} / ${acs.length}`} sub={`${(st.coolingW / 1000).toFixed(1)} kW cooling · ${(st.acElectricW / 1000).toFixed(1)} kW elec.`} />
        <Tile label="Energy used" value={`${st.energyKWh.toFixed(2)} kWh`} sub={`lights ${Math.round(st.lightW)} W`} />
        <Tile label="Est. time to comfort" value={est.toComfortSeconds != null ? formatDuration(est.toComfortSeconds) : '—'} sub={est.toComfortNote} />
        <Tile label="Heat gains" value={`${(st.gainW / 1000).toFixed(1)} kW`} sub="people, lights, solar, envelope" />
      </div>
      {edge.left && <button aria-label="Scroll metrics left" onClick={() => by(-360)} className="absolute left-0 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow hover:bg-white"><ChevronLeft size={15} /></button>}
      {edge.right && <button aria-label="Scroll metrics right" onClick={() => by(360)} className="absolute right-0 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow hover:bg-white"><ChevronRight size={15} /></button>}
    </div>
  )
}

function Devices() {
  const snap = useSim((s) => s.snapshot)
  const objects = useEditor((s) => s.space!.objects)
  const select = useEditor((s) => s.select)
  const layout = useLayout((s) => s.set)
  if (!snap) return null
  if (!snap.devices.length) return <div className="grid h-full place-items-center text-[13px] text-slate-500">No environmental devices in this space yet.</div>
  return (
    <div className="h-full overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-slate-50 text-left text-[11px] text-slate-500">
          <tr><th className="px-2 py-1.5 font-medium">Device</th><th className="px-2 font-medium">Mode</th><th className="px-2 font-medium">Level / state</th><th className="px-2 font-medium">Power</th><th className="px-2 font-medium">Heat removed</th></tr>
        </thead>
        <tbody>
          {snap.devices.map((d) => {
            const o = objects.find((x) => x.id === d.id)
            const max = o?.device && o.device.type !== 'light' ? o.device.levels.length - 1 : 0
            return (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-2 py-1"><button className="text-left font-medium text-slate-800 hover:text-blue-700" onClick={() => { select([d.id]); layout({ rightTab: 'properties' }) }}>{o?.name ?? d.id}</button></td>
                <td className="px-2">
                  <button onClick={() => setDevice(d.id, { mode: d.mode === 'auto' ? 'manual' : 'auto' })} className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', d.mode === 'auto' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700')}>{d.mode}</button>
                </td>
                <td className="px-2">
                  {d.type === 'light' ? (
                    <span className="flex items-center gap-2">
                      <button onClick={() => setDevice(d.id, { mode: 'manual', on: !d.on })} className={cn('rounded border px-1.5 text-[11px]', d.on ? 'border-yellow-300 bg-yellow-50 text-yellow-800' : 'border-slate-200 text-slate-500')}>{d.on ? 'On' : 'Off'}</button>
                      <span className="text-slate-500">{Math.round(d.dimming * 100)}%</span>
                    </span>
                  ) : (
                    <span className="flex gap-0.5">{Array.from({ length: max + 1 }, (_, i) => <button key={i} onClick={() => setDevice(d.id, { mode: 'manual', level: i })} className={cn('h-5 w-6 rounded border text-[11px]', d.level === i ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>{i === 0 ? '0' : i}</button>)}</span>
                  )}
                </td>
                <td className="px-2 tabular-nums">{Math.round(d.powerW)} W</td>
                <td className="px-2 tabular-nums">{d.type === 'ac' ? `${(d.coolingW / 1000).toFixed(2)} kW` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Zones() {
  const snap = useSim((s) => s.snapshot)
  const objects = useEditor((s) => s.space!.objects)
  const set = useEditor((s) => s.set)
  if (!snap) return null
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? id
  const under = snap.coverage.filter((c) => c.status === 'uncovered').length
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50" onClick={() => set({ layer: 'zones' })}>Show zones in 3D</button>
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50" onClick={() => set({ layer: 'coverage' })}>Show coverage in 3D</button>
        {under > 0 && <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">{under} underserved occupant(s): outside all AC / fan influence</span>}
      </div>
      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] text-slate-500"><tr>{['Zone', 'Area', 'People', 'Avg °C', 'Feels °C', 'Lux', 'Coverage', 'Devices', 'Comfort'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {snap.zones.map((z) => {
              const s = snap.zoneStats.find((x) => x.id === z.id)
              return (
                <tr key={z.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-medium">Zone {z.id + 1}</td><td className="px-2">{z.area.toFixed(0)} m²</td><td className="px-2">{s?.occupants ?? 0}</td>
                  <td className="px-2 tabular-nums">{s?.avgT.toFixed(1) ?? '—'}</td><td className="px-2 tabular-nums">{s?.avgPerceivedT.toFixed(1) ?? '—'}</td><td className="px-2 tabular-nums">{s ? Math.round(s.avgLux) : '—'}</td>
                  <td className="px-2"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', z.coverage === 'cooled' ? 'bg-emerald-50 text-emerald-700' : z.coverage === 'fan-only' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>{z.coverage}</span></td>
                  <td className="max-w-[320px] truncate px-2 text-slate-500" title={[...z.acIds, ...z.fanIds, ...z.lightIds].map(name).join(', ')}>{z.acIds.length} AC · {z.fanIds.length} fan · {z.lightIds.length} light</td>
                  <td className="px-2">{s && s.occupants > 0 ? (s.comfortable ? '✓' : '✗') : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {snap.stats.warnings.map((w) => <div key={w} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-900">{w}</div>)}
    </div>
  )
}

export function BottomDock() {
  const tab = useLayout((s) => s.bottomTab)
  const open = useLayout((s) => s.bottomOpen)
  const set = useLayout((s) => s.set)
  const st = useSim((s) => s.snapshot?.stats)
  const status = useSim((s) => s.status)
  return (
    <div className={cn('flex shrink-0 flex-col border-t border-slate-200 bg-slate-50', !open ? 'h-10' : tab === 'overview' ? 'h-[150px]' : 'h-[290px]')}>
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3">
        <button onClick={() => set({ bottomOpen: !open })} aria-label={open ? 'Collapse panel' : 'Expand panel'} className="rounded p-1 text-slate-500 hover:bg-slate-100">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        <span className={cn('h-2 w-2 rounded-full', status === 'running' ? 'animate-pulse bg-emerald-500' : status === 'paused' ? 'bg-amber-500' : 'bg-slate-300')} aria-hidden />
        <span className="sr-only">{status}</span>
        <SimControls compact />
        {st && <span className="ml-1 hidden whitespace-nowrap text-[12px] text-slate-600 2xl:inline">{st.avgT.toFixed(1)} °C · {Math.round(st.avgLux)} lx · {st.occupants} people · {st.energyKWh.toFixed(2)} kWh</span>}
        <div className="ml-auto flex shrink-0 gap-0.5 whitespace-nowrap">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => set({ bottomTab: t.id, bottomOpen: true })} className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium', tab === t.id && open ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100')}>{t.label}</button>
          ))}
        </div>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-hidden p-2.5">
          {tab === 'overview' && <Overview />}
          {tab === 'charts' && <SimCharts />}
          {tab === 'devices' && <Devices />}
          {tab === 'zones' && <Zones />}
          {tab === 'cooling' && <CoolingTab />}
        </div>
      )}
    </div>
  )
}
