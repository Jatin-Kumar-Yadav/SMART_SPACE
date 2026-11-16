import { Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { layoutCircuit, NET_COLOUR, type CTone } from '@/iot/circuit'
import type { HardwarePlan } from '@/iot/types'

const TONE: Record<CTone, { fill: string; stroke: string; head: string }> = {
  board: { fill: '#eff6ff', stroke: '#2563eb', head: '#2563eb' },
  sensor: { fill: '#f0fdf4', stroke: '#16a34a', head: '#16a34a' },
  actuator: { fill: '#fff7ed', stroke: '#ea580c', head: '#ea580c' },
  expander: { fill: '#f5f3ff', stroke: '#7c3aed', head: '#7c3aed' },
  supply: { fill: '#fef2f2', stroke: '#dc2626', head: '#dc2626' },
}
const LEGEND: [string, string][] = [['3.3 V / 5 V', NET_COLOUR.power], ['GND', NET_COLOUR.ground], ['Signal', NET_COLOUR.signal], ['I²C', NET_COLOUR.i2c], ['Motor supply', NET_COLOUR['ext-power']]]

/** Zoom / pan wiring diagram of one controller. Generated from the plan, so it always matches the pin table. */
export function CircuitView({ plan, ctrl, selected, onSelect }: { plan: HardwarePlan; ctrl: string; selected?: string | null; onSelect?: (id: string) => void }) {
  const layout = useMemo(() => layoutCircuit(plan, ctrl), [plan, ctrl])
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const fit = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const k = Math.min(1.4, Math.max(0.2, Math.min((r.width - 20) / layout.width, (r.height - 20) / layout.height)))
    setView({ k, x: (r.width - layout.width * k) / 2, y: 10 })
  }
  useEffect(fit, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number, cx?: number, cy?: number) => setView((v) => {
    const r = box.current!.getBoundingClientRect()
    const px = cx ?? r.width / 2
    const py = cy ?? r.height / 2
    const k = Math.min(3, Math.max(0.15, v.k * f))
    return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
  })

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:18px_18px]" ref={box}>
      <svg
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Wiring diagram of ${ctrl}`}
        onWheel={(e) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top) }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })) }}
        onPointerUp={() => { drag.current = null }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.wires.map((w) => (
            <polyline key={w.id} points={w.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={NET_COLOUR[w.kind]} strokeWidth={hover === w.netId ? 3.2 : 1.6} strokeLinejoin="round" opacity={hover && hover !== w.netId ? 0.25 : 0.9} onPointerEnter={() => setHover(w.netId)} onPointerLeave={() => setHover(null)}>
              <title>{w.label}</title>
            </polyline>
          ))}
          {layout.boxes.map((b) => {
            const t = TONE[b.tone]
            return (
              <g key={b.id} onClick={() => onSelect?.(b.id)} className="cursor-pointer">
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill={t.fill} stroke={selected === b.id ? '#0f172a' : t.stroke} strokeWidth={selected === b.id ? 2.5 : 1.3} />
                <path d={`M${b.x},${b.y + 8} a8,8 0 0 1 8,-8 h${b.w - 16} a8,8 0 0 1 8,8 v18 h-${b.w} z`} fill={t.head} />
                <text x={b.x + 10} y={b.y + 14} fontSize={11.5} fontWeight={700} fill="#fff">{b.title}</text>
                {b.subtitle && <text x={b.x + 10} y={b.y + 26} fontSize={9.5} fill="#e2e8f0">{b.subtitle.length > 40 ? `${b.subtitle.slice(0, 39)}…` : b.subtitle}</text>}
                {b.pins.map((p) => (
                  <g key={p.name}>
                    <circle cx={p.x} cy={p.y} r={3.4} fill="#fff" stroke="#334155" strokeWidth={1.2} />
                    <text x={p.side === 'l' ? p.x + 8 : p.x - 8} y={p.y + 3.5} fontSize={10} textAnchor={p.side === 'l' ? 'start' : 'end'} fill="#0f172a" fontFamily="ui-monospace,monospace">{p.name}</text>
                  </g>
                ))}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm">
        <Button variant="ghost" size="iconSm" aria-label="Zoom in" onClick={() => zoom(1.25)}><Plus size={14} /></Button>
        <Button variant="ghost" size="iconSm" aria-label="Zoom out" onClick={() => zoom(0.8)}><Minus size={14} /></Button>
        <Button variant="ghost" size="iconSm" aria-label="Fit to view" onClick={fit}><Maximize2 size={13} /></Button>
      </div>
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-0.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10.5px] text-slate-600 shadow-sm">
        {LEGEND.map(([l, c]) => <span key={l} className="flex items-center gap-1"><span className="h-0.5 w-4 rounded" style={{ background: c }} />{l}</span>)}
      </div>
    </div>
  )
}
