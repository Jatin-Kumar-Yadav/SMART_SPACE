import { Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { layoutCircuit, type CTone } from '@/iot/circuit'
import { WIRE_COLOUR, WIRE_LABEL, type WireClass } from '@/iot/manifest'
import type { HardwarePlan } from '@/iot/types'
import type { IotFilter } from '@/store/iotStore'
import { Art, type ArtState } from './art'

const TONE: Record<CTone, { stroke: string; head: string }> = {
  board: { stroke: '#2563eb', head: '#1e3a8a' },
  sensor: { stroke: '#16a34a', head: '#166534' },
  actuator: { stroke: '#ea580c', head: '#9a3412' },
  expander: { stroke: '#7c3aed', head: '#5b21b6' },
  supply: { stroke: '#dc2626', head: '#991b1b' },
}
const LEGEND: WireClass[] = ['power', 'ground', 'digital', 'sensor', 'pwm', 'comms', 'motor-power']

export interface CircuitViewProps {
  plan: HardwarePlan
  ctrl: string
  filter: IotFilter
  selected: string | null
  onSelect: (id: string | null) => void
  /** live picture of each part (duty / reading), keyed by part id */
  art: Record<string, ArtState>
  running: boolean
  onSensor?: (partId: string, at: { x: number; y: number }) => void
}

/** Wokwi-style wiring diagram of one controller. Generated from the plan/netlist, so it always matches the pin table and the code. */
export function CircuitView({ plan, ctrl, filter, selected, onSelect, art, running, onSensor }: CircuitViewProps) {
  const layout = useMemo(() => layoutCircuit(plan, ctrl), [plan, ctrl])
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const fit = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width) return
    const k = Math.min(1.3, Math.max(0.2, Math.min((r.width - 20) / layout.width, (r.height - 20) / layout.height)))
    setView({ k, x: (r.width - layout.width * k) / 2, y: 10 })
  }
  useEffect(fit, [layout]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number, cx?: number, cy?: number) => setView((v) => {
    const r = box.current!.getBoundingClientRect()
    const px = cx ?? r.width / 2
    const py = cy ?? r.height / 2
    const k = Math.min(3, Math.max(0.15, v.k * f))
    return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
  })

  const isNet = selected != null && layout.wires.some((w) => w.netId === selected)
  const live = (w: (typeof layout.wires)[number]) => !selected || (isNet ? w.netId === selected : w.target === selected || w.hub === selected)
  const litBoxes = new Set<string>()
  if (selected) {
    for (const w of layout.wires) if (live(w)) { litBoxes.add(w.hub); litBoxes.add(w.target) }
    litBoxes.add(selected)
  }
  const ioDim = (io: 'input' | 'output' | 'neutral') => (filter === 'inputs' && io === 'output') || (filter === 'outputs' && io === 'input')
  const boxById = new Map(layout.boxes.map((b) => [b.id, b]))
  const wireDim = (w: (typeof layout.wires)[number]) => {
    const t = boxById.get(w.target)
    const h = boxById.get(w.hub)
    return (!!t && ioDim(t.io)) || (!!h && ioDim(h.io))
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f8fafc] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:18px_18px]" ref={box} data-testid="circuit-view">
      <svg
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Wiring diagram of ${ctrl}`}
        onWheel={(e) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top) }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false } }}
        onPointerMove={(e) => { const d = drag.current; if (d) { if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) { d.moved = true; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId) } if (!d.moved) return; setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })) } }}
        onPointerUp={() => { drag.current = null }}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect(null) }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.breadboard && (
            <g aria-hidden>
              <rect {...layout.breadboard} rx={10} fill="#f5efe0" stroke="#d6c9a8" />
              <rect x={layout.breadboard.x + 6} y={layout.breadboard.y + 6} width={layout.breadboard.w - 12} height={4} fill="#ef4444" opacity={0.5} />
              <rect x={layout.breadboard.x + 6} y={layout.breadboard.y + 12} width={layout.breadboard.w - 12} height={4} fill="#3b82f6" opacity={0.5} />
              <text x={layout.breadboard.x + layout.breadboard.w - 8} y={layout.breadboard.y + layout.breadboard.h - 6} textAnchor="end" fontSize={9} fill="#a8a29e">breadboard / perfboard</text>
            </g>
          )}
          {layout.wires.map((w) => {
            const on = live(w)
            const dim = !on || wireDim(w)
            const hot = !!selected && on
            return (
              <g key={w.id} opacity={dim ? 0.12 : 1}>
                <polyline points={w.points.map((p) => p.join(',')).join(' ')} fill="none" stroke="transparent" strokeWidth={10} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect(w.netId) }} />
                <polyline data-testid="wire" data-class={w.cls} data-net={w.netId} data-hot={hot ? '1' : '0'} points={w.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={WIRE_COLOUR[w.cls]} strokeWidth={hot ? 3.6 : 1.9} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none">
                  <title>{w.label}</title>
                </polyline>
              </g>
            )
          })}
          {layout.boxes.map((b) => {
            const t = TONE[b.tone]
            const dim = ioDim(b.io) || (!!selected && !litBoxes.has(b.partId ?? b.id))
            const sel = selected === (b.partId ?? b.id)
            const clickSensor = b.io === 'input' && !!onSensor
            return (
              <g key={b.id} data-testid={`part-${b.id}`} data-io={b.io} data-dim={dim ? '1' : '0'} opacity={dim ? 0.22 : 1} className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : (b.partId ?? b.id)); if (clickSensor) onSensor?.(b.id, { x: e.clientX, y: e.clientY }) }}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#ffffff" fillOpacity={0.92} stroke={sel ? '#0f172a' : t.stroke} strokeWidth={sel ? 2.6 : 1.3} />
                <path d={`M${b.x},${b.y + 8} a8,8 0 0 1 8,-8 h${b.w - 16} a8,8 0 0 1 8,8 v12 h-${b.w} z`} fill={t.head} />
                <text x={b.x + 9} y={b.y + 14} fontSize={11} fontWeight={700} fill="#fff">{b.title}</text>
                {b.subtitle && <text x={b.x + b.w - 8} y={b.y + 14} fontSize={8.5} fill="#cbd5e1" textAnchor="end">{b.subtitle.length > 30 ? `${b.subtitle.slice(0, 29)}…` : b.subtitle}</text>}
                <g transform={`translate(${b.x} ${b.artY})`}><Art kind={b.art} w={b.w} st={{ ...art[b.partId ?? b.id], running }} /></g>
                {art[b.partId ?? b.id]?.note && b.art !== 'mosfet' && <text x={b.x + b.w - 6} y={b.artY + 11} fontSize={8.5} textAnchor="end" fill="#475569" fontStyle="italic" data-testid="state-note">{art[b.partId ?? b.id].note}</text>}
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
        {LEGEND.map((c) => <span key={c} className="flex items-center gap-1"><span className="h-1 w-4 rounded" style={{ background: WIRE_COLOUR[c] }} />{WIRE_LABEL[c]}</span>)}
      </div>
    </div>
  )
}
