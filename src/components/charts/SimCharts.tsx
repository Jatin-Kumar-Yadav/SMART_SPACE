import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { HistoryPoint } from '@/simulation/types'
import { useSim } from '@/store/simStore'
import { Toggle } from '@/components/ui/controls'
import { CHART_SERIES as SERIES } from '@/three/overlays/colors'

const MUTED = '#8a8f98'

interface Row extends HistoryPoint {
  min: number
}

interface LineSpec {
  key: keyof HistoryPoint
  name: string
  color: string
  dashed?: boolean
  thin?: boolean
}

function Chart({ title, unit, rows, lines, step = false, domain }: {
  title: string
  unit: string
  rows: Row[]
  lines: LineSpec[]
  step?: boolean
  domain?: [number | 'auto', number | 'auto']
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h4 className="text-[11px] font-semibold text-slate-700">{title}</h4>
        <span className="text-[10px] text-slate-400">{unit}</span>
      </div>
      <div className="h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="min" type="number" domain={[0, 'dataMax']} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#d9dde3' }} tickFormatter={(v: number) => `${Math.round(v)}m`} />
            <YAxis domain={domain ?? ['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={38} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(+v.toFixed(1)))} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e5ea', padding: '4px 8px' }}
              labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`}
              formatter={(v, n) => [typeof v === 'number' ? v.toFixed(2) : String(v), n]}
            />
            {lines.map((l) => (
              <Line key={l.key} type={step ? 'stepAfter' : 'monotone'} dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={l.thin ? 1 : 2} strokeDasharray={l.dashed ? '4 3' : undefined} dot={false} isAnimationActive={false} />
            ))}
            {rows.length === 0 && <ReferenceLine y={0} stroke="transparent" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 px-1 pt-1 text-[10px] text-slate-500">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1">
            <i className="inline-block h-0.5 w-3" style={{ background: l.color, opacity: l.thin ? 0.6 : 1 }} />
            {l.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Real simulation history: every chart plots values recorded by the engine, nothing is synthetic. */
export function SimCharts() {
  const history = useSim((s) => s.snapshot?.history)
  const [table, setTable] = useState(false)
  const rows = useMemo<Row[]>(() => (history ?? []).map((h) => ({ ...h, min: h.t / 60 })), [history])
  if (rows.length < 2) {
    return <div className="grid h-full place-items-center text-[13px] text-slate-500">Press Start to record the simulation. Charts plot the values the engine produces.</div>
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-end"><Toggle checked={table} onChange={setTable} label="Table view" /></div>
      {table ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr>{['t (min)', 'Avg °C', 'Min °C', 'Max °C', 'Lux', 'AC kW', 'Fan lvl', 'kWh'].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 60)) === 0).map((r) => (
                <tr key={r.t} className="border-t border-slate-100">
                  <td className="px-2 py-0.5">{r.min.toFixed(1)}</td><td className="px-2">{r.avgT.toFixed(2)}</td><td className="px-2">{r.minT.toFixed(2)}</td><td className="px-2">{r.maxT.toFixed(2)}</td>
                  <td className="px-2">{Math.round(r.avgLux)}</td><td className="px-2">{(r.acPowerW / 1000).toFixed(2)}</td><td className="px-2">{r.fanLevel.toFixed(1)}</td><td className="px-2">{r.energyKWh.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto xl:grid-cols-3">
          <Chart title="Temperature vs time" unit="°C" rows={rows} lines={[
            { key: 'avgT', name: 'Average', color: SERIES.blue },
            { key: 'maxT', name: 'Max', color: SERIES.blue, thin: true },
            { key: 'minT', name: 'Min', color: SERIES.blue, thin: true },
            { key: 'targetT', name: 'Target', color: MUTED, dashed: true },
          ]} />
          <Chart title="Lighting vs time" unit="lux" rows={rows} lines={[{ key: 'occLux', name: 'At occupied seats', color: SERIES.aqua }, { key: 'avgLux', name: 'Room average', color: SERIES.violet, dashed: true }]} />
          <Chart title="AC power vs time" unit="W" rows={rows} lines={[{ key: 'acPowerW', name: 'AC electrical', color: SERIES.orange }, { key: 'coolingW', name: 'Heat removed', color: SERIES.orange, thin: true }]} />
          <Chart title="Fan level vs time" unit="mean level" rows={rows} step lines={[{ key: 'fanLevel', name: 'Mean fan level', color: SERIES.violet }]} />
          <Chart title="Energy vs time" unit="kWh" rows={rows} lines={[{ key: 'energyKWh', name: 'Cumulative energy', color: SERIES.yellow }]} />
          <Chart title="Lighting power vs time" unit="W" rows={rows} lines={[{ key: 'lightPowerW', name: 'Lights', color: SERIES.aqua }]} />
        </div>
      )}
    </div>
  )
}
