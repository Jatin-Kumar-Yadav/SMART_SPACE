import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Field, NumberInput } from '@/components/ui/controls'
import { SERIES } from '@/components/charts/SimCharts'
import { airMass, formatDuration, idealCoolingTime, sensibleEnergy, timeToReach, CP_AIR, RHO_AIR } from '@/simulation/analytic'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'

/** The formula from the brief:  t = −(1/k)·ln((Tdes − Ttarget)/(Tinit − Ttarget)) */
function Calculator() {
  const snap = useSim((s) => s.snapshot)
  const target = useEditor((s) => { const sc = activeScenario(s.space!); return sc.targetTempC + sc.sim.toleranceC })
  const est = snap?.stats.estimate
  const [tInit, setTInit] = useState<number | null>(null)
  const [tTgt, setTTgt] = useState<number | null>(null)
  const [tDes, setTDes] = useState<number | null>(null)
  const [kPerMin, setK] = useState<number | null>(null)
  const ti = tInit ?? snap?.stats.avgT ?? 32
  const tt = tTgt ?? (est && Number.isFinite(est.tTarget) ? +est.tTarget.toFixed(2) : 20)
  const td = tDes ?? target
  const k = kPerMin ?? (est ? +(est.k * 60).toFixed(4) : 0.05)
  const res = timeToReach(td, ti, tt, k / 60)
  const text = res.kind === 'ok' ? formatDuration(res.seconds) : res.kind === 'already' ? 'Already there' : res.message
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-1 text-[12px] font-semibold text-slate-900">Exponential cooling calculator</h4>
      <p className="mb-2 font-mono text-[11px] text-slate-500">T(t) = T<sub>target</sub> + (T<sub>init</sub> − T<sub>target</sub>)·e<sup>−kt</sup></p>
      <div className="grid grid-cols-4 gap-2">
        <Field label="T initial (°C)"><NumberInput value={ti} step={0.5} onCommit={setTInit} /></Field>
        <Field label="T steady (°C)"><NumberInput value={tt} step={0.5} onCommit={setTTgt} /></Field>
        <Field label="T desired (°C)"><NumberInput value={td} step={0.5} onCommit={setTDes} /></Field>
        <Field label="k (1/min)"><NumberInput value={k} step={0.005} digits={4} min={0} onCommit={setK} /></Field>
      </div>
      <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">Time to reach {td} °C: <b className={res.kind === 'ok' || res.kind === 'already' ? 'text-emerald-700' : 'text-amber-700'}>{text}</b></div>
      <p className="mt-1 text-[10.5px] leading-snug text-slate-400">Prefilled from the live model (steady state and k at the current device levels); “desired” defaults to the upper edge of the comfort band, matching “Time to comfort”. T steady is the temperature the AC can hold; the desired value must lie between T initial and T steady.</p>
    </div>
  )
}

/** Part 16 worked example computed with the same functions the engine tests use. */
function WorkedExample() {
  const V = 10 * 8 * 3
  const m = airMass(V, RHO_AIR)
  const dT = 32 - 24
  const Q = sensibleEnergy(m, dT, CP_AIR)
  const net = 3500 - 1000
  const t = idealCoolingTime(Q, 3500, 1000)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-700">
      <h4 className="mb-1 font-semibold text-slate-900">Worked example — idealised air-only cooling</h4>
      <div className="font-mono text-[11px] leading-relaxed text-slate-600">
        10 m × 8 m × 3 m → V = {V} m³ · m = ρV = {m.toFixed(0)} kg<br />
        Q = m·Cp·ΔT = {m.toFixed(0)} × {CP_AIR} × {dT} = {Q.toLocaleString()} J<br />
        P<sub>net</sub> = 3500 W − 1000 W = {net} W<br />
        t = Q / P<sub>net</sub> = <b>{t.kind === 'ok' ? `${Math.round(t.seconds)} s ≈ ${(t.seconds / 60).toFixed(1)} min` : '—'}</b>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-slate-400">An idealised lower bound: walls, floor, furniture, humidity and leakage store or add heat, so the dynamic simulation (effective thermal capacitance) takes longer. Not a guaranteed result.</p>
    </div>
  )
}

export function CoolingTab() {
  const snap = useSim((s) => s.snapshot)
  const sc = useEditor((s) => activeScenario(s.space!))
  const data = useMemo(() => {
    if (!snap) return []
    const h = snap.history
    const rows: { min: number; sim?: number; proj?: number }[] = h.map((p) => ({ min: p.t / 60, sim: p.avgT }))
    const est = snap.stats.estimate
    if (Number.isFinite(est.tTarget) && est.k > 0) {
      const t0 = snap.stats.time
      const span = Math.min(4 * 3600, Math.max(1800, 5 / est.k))
      for (let i = 0; i <= 40; i++) {
        const tau = (span * i) / 40
        rows.push({ min: (t0 + tau) / 60, proj: est.tTarget + (snap.stats.avgT - est.tTarget) * Math.exp(-est.k * tau) })
      }
    }
    return rows
  }, [snap])
  const est = snap?.stats.estimate
  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-auto lg:grid-cols-[1.1fr_1fr]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Time to comfort', est?.toComfortSeconds != null ? formatDuration(est.toComfortSeconds) : '—', est?.toComfortNote],
            ['Time to equilibrium', est?.toEquilibriumSeconds != null ? formatDuration(est.toEquilibriumSeconds) : '—', '≈ 4 time constants'],
            ['Steady state', est && Number.isFinite(est.tTarget) ? `${est.tTarget.toFixed(1)} °C` : '—', 'AC can hold this at current levels'],
            ['Rate k', est ? `${(est.k * 60).toFixed(3)} /min` : '—', 'k = (UA + G_ac) / C_eff'],
          ].map(([l, v, d]) => (
            <div key={l} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{l}</div>
              <div className="text-[15px] font-semibold text-slate-900">{v}</div>
              <div className="text-[10px] leading-tight text-slate-400">{d}</div>
            </div>
          ))}
        </div>
        <div className="h-[150px] rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-0.5 flex items-baseline justify-between px-1"><h4 className="text-[11px] font-semibold text-slate-700">Average temperature: simulated vs exponential projection</h4><span className="text-[10px] text-slate-400">°C</span></div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="min" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} tickFormatter={(v: number) => `${Math.round(v)}m`} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => v.toFixed(0)} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, padding: '4px 8px' }} labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`} formatter={(v, n) => [typeof v === 'number' ? `${v.toFixed(2)} °C` : String(v), n]} />
              <ReferenceLine y={sc.targetTempC} stroke="#8a8f98" strokeDasharray="4 3" label={{ value: 'target', fontSize: 10, fill: '#8a8f98', position: 'insideTopRight' }} />
              <Line dataKey="sim" name="Simulated" stroke={SERIES.blue} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="proj" name="Exponential projection" stroke={SERIES.orange} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2"><Calculator /><WorkedExample /></div>
    </div>
  )
}
