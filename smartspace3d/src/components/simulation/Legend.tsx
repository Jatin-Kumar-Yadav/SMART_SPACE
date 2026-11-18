import { LUX_LEGEND, LUX_MAX, cssRgb, luxColor, tempColor, tempRange } from '@/three/overlays/colors'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'

const grad = (fn: (t: number) => [number, number, number]) =>
  `linear-gradient(to right, ${Array.from({ length: 11 }, (_, i) => cssRgb(fn(i / 10))).join(',')})`

/** Colour legend for the active visualisation layer. */
export function Legend() {
  const layer = useEditor((s) => s.layer)
  const target = useEditor((s) => activeScenario(s.space!).targetTempC)
  const snap = useSim((s) => s.snapshot)
  const box = 'pointer-events-none absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/92 px-3 py-2 text-[11px] text-slate-700 shadow'
  if (layer === 'temperature') {
    const [lo, hi] = tempRange(snap, target)
    return (
      <div className={box}>
        <div className="mb-1 font-semibold">Air temperature (°C)</div>
        <div className="h-2.5 w-56 rounded" style={{ background: grad(tempColor) }} />
        <div className="mt-0.5 flex w-56 justify-between text-slate-500">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{(lo + (hi - lo) * f).toFixed(0)}</span>)}</div>
        <div className="mt-0.5 text-slate-400">Blue cooler · green moderate · yellow warm · red hot</div>
      </div>
    )
  }
  if (layer === 'lighting') {
    return (
      <div className={box}>
        <div className="mb-1 font-semibold">Illuminance (lux)</div>
        <div className="h-2.5 w-56 rounded" style={{ background: grad(luxColor) }} />
        <div className="relative mt-0.5 h-3 w-56 text-slate-500">
          {LUX_LEGEND.map((v) => <span key={v} className="absolute -translate-x-1/2" style={{ left: `${(v / LUX_MAX) * 100}%`, transform: v === 0 ? 'none' : v === LUX_MAX ? 'translateX(-100%)' : undefined }}>{v}</span>)}
        </div>
      </div>
    )
  }
  if (layer === 'coverage') {
    return (
      <div className={box}>
        <div className="mb-1 font-semibold">Occupant coverage</div>
        {[['#16a34a', 'Covered (AC and fan/light)'], ['#f59e0b', 'Partial coverage'], ['#dc2626', 'Uncovered / underserved']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</div>
        ))}
      </div>
    )
  }
  if (layer === 'airflow') {
    return <div className={box}><div className="font-semibold">Device influence</div><div className="text-slate-500">Translucent regions show fan / AC reach at their current level.</div></div>
  }
  if (layer === 'zones') return <div className={box}><div className="font-semibold">Environmental zones</div><div className="text-slate-500">Cells are grouped by the devices that reach them.</div></div>
  if (layer === 'occupancy') return <div className={box}><div className="font-semibold">Occupancy density</div><div className="text-slate-500">Warm cells contain seated occupants.</div></div>
  return null
}
