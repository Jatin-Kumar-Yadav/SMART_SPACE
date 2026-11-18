import { Layers, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { layoutCircuit, NET_COLOUR, type CTone } from '@/iot/circuit'
import type { HardwarePlan } from '@/iot/types'
import { generateWokwi } from '@/iot/wokwi'
import { useIot } from '@/store/iotStore'
import {
  Dht22Artwork,
  Ds18b20Artwork,
  Esp32Artwork,
  getPartDims,
  getPinOffset,
  LdrArtwork,
  LedArtwork,
  PirArtwork,
  ResistorArtwork,
  UnoArtwork,
} from './WokwiComponents'

interface WokwiPart {
  type: string
  id: string
  top: number
  left: number
  attrs?: Record<string, string>
  rotate?: number
}

interface WokwiDiagram {
  version: number
  parts: WokwiPart[]
  connections: Array<[string, string, string, string[]]>
}

const TONE: Record<CTone, { fill: string; stroke: string; head: string }> = {
  board: { fill: '#eff6ff', stroke: '#2563eb', head: '#2563eb' },
  sensor: { fill: '#f0fdf4', stroke: '#16a34a', head: '#16a34a' },
  actuator: { fill: '#fff7ed', stroke: '#ea580c', head: '#ea580c' },
  expander: { fill: '#f5f3ff', stroke: '#7c3aed', head: '#7c3aed' },
  supply: { fill: '#fef2f2', stroke: '#dc2626', head: '#dc2626' },
}

const SCHEMATIC_LEGEND: [string, string][] = [
  ['3.3 V / 5 V', NET_COLOUR.power],
  ['GND', NET_COLOUR.ground],
  ['Signal', NET_COLOUR.signal],
  ['I²C', NET_COLOUR.i2c],
  ['Motor supply', NET_COLOUR['ext-power']],
]

const WOKWI_LEGEND: [string, string][] = [
  ['Power (3.3V / 5V)', '#dc2626'],
  ['Ground (GND)', '#0f172a'],
  ['AC Output', '#0284c7'],
  ['Fan Output', '#16a34a'],
  ['Light Output', '#ca8a04'],
  ['Temp Sensor (DHT22)', '#2563eb'],
  ['Light Sensor (LDR)', '#d97706'],
  ['PIR Motion', '#9333ea'],
]

/**
 * Realistic Wokwi Electronics Circuit Simulator View.
 * Parses the exact generated `diagram.json` from the hardware plan and renders authentic
 * component illustrations, pin terminals, and orthogonal wiring on a Wokwi-style dark canvas.
 */
export function CircuitView({
  plan,
  ctrl,
  selected,
  onSelect,
}: {
  plan: HardwarePlan
  ctrl: string
  selected?: string | null
  onSelect?: (id: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [hoverWire, setHoverWire] = useState<string | null>(null)
  const [hoverPin, setHoverPin] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'wokwi' | 'schematic'>('wokwi')

  const wokwiStore = useIot((s) => s.wokwi)
  const tempThreshold = useIot((s) => s.tempThreshold)
  const lightThreshold = useIot((s) => s.lightThreshold)

  // 1. Get or generate the exact Wokwi diagram.json as source of truth
  const diagram: WokwiDiagram | null = useMemo(() => {
    let wk = wokwiStore[ctrl]
    if (!wk || !wk.ok) {
      wk = generateWokwi(plan, {
        spaceId: 'preview',
        controllerId: ctrl,
        tempThreshold,
        lightThreshold,
      })
    }
    if (wk && wk.ok) {
      try {
        return JSON.parse(wk.files['diagram.json']) as WokwiDiagram
      } catch {
        return null
      }
    }
    return null
  }, [wokwiStore, ctrl, plan, tempThreshold, lightThreshold])

  // Fallback schematic layout (for unsupported controllers like Raspberry Pi or if toggled)
  const schematicLayout = useMemo(() => layoutCircuit(plan, ctrl), [plan, ctrl])

  // Compute bounding box of the Wokwi diagram for auto-fit and centering
  const bounds = useMemo(() => {
    if (!diagram || !diagram.parts.length) {
      return { minX: 0, minY: 0, maxX: schematicLayout.width, maxY: schematicLayout.height, width: schematicLayout.width, height: schematicLayout.height }
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const part of diagram.parts) {
      const dims = getPartDims(part.type)
      minX = Math.min(minX, part.left)
      minY = Math.min(minY, part.top)
      maxX = Math.max(maxX, part.left + dims.w)
      maxY = Math.max(maxY, part.top + dims.h)
    }

    // Add margin for wires and labels
    const pad = 70
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX += pad + 60
    maxY += pad + 50

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(860, maxX - minX),
      height: Math.max(540, maxY - minY),
    }
  }, [diagram, schematicLayout])

  // Fit to screen calculation
  const fit = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const targetW = viewMode === 'wokwi' ? bounds.width : schematicLayout.width
    const targetH = viewMode === 'wokwi' ? bounds.height : schematicLayout.height
    const k = Math.min(1.3, Math.max(0.35, Math.min((r.width - 40) / targetW, (r.height - 40) / targetH)))
    const x = (r.width - targetW * k) / 2 - (viewMode === 'wokwi' ? bounds.minX * k : 0)
    const y = Math.max(15, (r.height - targetH * k) / 2 - (viewMode === 'wokwi' ? bounds.minY * k : 0))
    setView({ k, x, y })
  }

  // Auto-fit on layout or viewMode change
  useEffect(fit, [bounds, viewMode, schematicLayout]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return v
      const px = cx ?? r.width / 2
      const py = cy ?? r.height / 2
      const nextK = Math.min(2.8, Math.max(0.25, v.k * factor))
      return {
        k: nextK,
        x: px - ((px - v.x) / v.k) * nextK,
        y: py - ((py - v.y) / v.k) * nextK,
      }
    })
  }

  const resetView = () => {
    fit()
  }

  // Resolve world coordinates for any partId:pinName
  const getPinWorld = (pinKey: string): { x: number; y: number; side?: 'l' | 'r' | 't' | 'b' } | null => {
    if (!diagram) return null
    const [partId, pinName] = pinKey.split(':')
    const part = diagram.parts.find((p) => p.id === partId)
    if (!part) return null
    const offset = getPinOffset(part.type, pinName)
    return {
      x: part.left + offset.x,
      y: part.top + offset.y,
      side: offset.side,
    }
  }

  // Compute clean orthogonal wire routing path between two pins
  const computeWirePath = (fromKey: string, toKey: string, index: number): string => {
    const p1 = getPinWorld(fromKey)
    const p2 = getPinWorld(toKey)
    if (!p1 || !p2) return ''

    const x1 = p1.x
    const y1 = p1.y
    const x2 = p2.x
    const y2 = p2.y

    // 1. Resistor pin 2 to LED pin A (short horizontal link)
    if (fromKey.includes(':2') && toKey.includes(':A')) {
      if (Math.abs(y1 - y2) < 25 && x2 > x1 && x2 - x1 < 80) {
        return `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
      }
    }

    // 2. LED cathode (LED:C) to GND (forms clean unified ground rail)
    if (fromKey.includes(':C') && toKey.includes('GND')) {
      const gndRailY = bounds.maxY - 40
      const mcuGndEntryX = Math.min(x1, x2) - 25
      return `M ${x1} ${y1} V ${gndRailY} H ${mcuGndEntryX} V ${y2} H ${x2}`
    }

    // 3. MCU to Right Column (Resistors / Actuators)
    if (x2 > x1 + 80) {
      // Pin on left side of MCU looping around bottom
      if (p1.side === 'l') {
        const loopY = bounds.maxY - 65 - (index % 3) * 10
        const rightTrunkX = x1 + 140 + (index % 5) * 8
        return `M ${x1} ${y1} H ${x1 - 20} V ${loopY} H ${rightTrunkX} V ${y2} H ${x2}`
      }
      // Pin on right side of MCU
      const trunkX = x1 + 35 + ((index * 7) % 30)
      return `M ${x1} ${y1} H ${trunkX} V ${y2} H ${x2}`
    }

    // 4. MCU to Left Column (Sensors)
    if (x2 < x1 - 80) {
      // Pin on right side of MCU looping around bottom
      if (p1.side === 'r') {
        const loopY = bounds.maxY - 50 - (index % 3) * 10
        const leftTrunkX = x2 + 50 + (index % 4) * 8
        return `M ${x1} ${y1} H ${x1 + 20} V ${loopY} H ${leftTrunkX} V ${y2} H ${x2}`
      }
      // Pin on left side of MCU
      const trunkX = x2 + 60 + ((index * 6) % 25)
      return `M ${x1} ${y1} H ${trunkX} V ${y2} H ${x2}`
    }

    // Default orthogonal 2-bend step
    const midX = (x1 + x2) / 2
    return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
  }

  // If Wokwi cannot be generated for this family, default to schematic
  const isWokwiSupported = diagram !== null && diagram.parts.length > 0

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${
        viewMode === 'wokwi' && isWokwiSupported
          ? 'bg-[#222226]'
          : 'bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:18px_18px]'
      }`}
      ref={box}
    >
      <svg
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Circuit preview for ${ctrl}`}
        onWheel={(e) => {
          e.preventDefault()
          const r = box.current!.getBoundingClientRect()
          zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* ================= MODE A: WOKWI REALISTIC ELECTRONICS PREVIEW ================= */}
          {viewMode === 'wokwi' && isWokwiSupported && (
            <>
              {/* Subtle background canvas grid dots like Wokwi */}
              <defs>
                <pattern id="wokwi-grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.2" fill="rgba(255, 255, 255, 0.07)" />
                </pattern>
                <filter id="wokwi-wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect
                x={bounds.minX - 200}
                y={bounds.minY - 200}
                width={bounds.width + 400}
                height={bounds.height + 400}
                fill="url(#wokwi-grid-dots)"
              />

              {/* Connecting Wires (Orthogonal right-angle paths) */}
              <g id="wokwi-wires">
                {diagram.connections.map(([fromKey, toKey, color], idx) => {
                  const wireId = `${fromKey}->${toKey}`
                  const pathD = computeWirePath(fromKey, toKey, idx)
                  const isHovered = hoverWire === wireId
                  const isPinHovered = hoverPin === fromKey || hoverPin === toKey

                  return (
                    <g key={wireId} className="cursor-pointer">
                      <path
                        d={pathD}
                        fill="none"
                        stroke={color}
                        strokeWidth={isHovered || isPinHovered ? 4.2 : 2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={hoverWire && !isHovered ? 0.35 : 0.95}
                        filter={isHovered || isPinHovered ? 'url(#wokwi-wire-glow)' : undefined}
                        onPointerEnter={() => setHoverWire(wireId)}
                        onPointerLeave={() => setHoverWire(null)}
                      >
                        <title>{`${fromKey} ↔ ${toKey} (${color})`}</title>
                      </path>

                      {/* Small terminal connection dots at wire endpoints */}
                      {pCoord(getPinWorld(fromKey))}
                      {pCoord(getPinWorld(toKey))}
                    </g>
                  )
                })}
              </g>

              {/* Components rendered at exact diagram.json coordinates */}
              <g id="wokwi-parts">
                {diagram.parts.map((part) => {
                  const isSelected = selected === part.id

                  return (
                    <g
                      key={part.id}
                      transform={`translate(${part.left} ${part.top})`}
                      className="cursor-pointer"
                      onClick={() => onSelect?.(part.id)}
                      onPointerEnter={() => setHoverPin(part.id)}
                      onPointerLeave={() => setHoverPin(null)}
                    >
                      {renderWokwiPart(part, isSelected)}
                      <title>{`${part.id} (${part.type})`}</title>
                    </g>
                  )
                })}
              </g>
            </>
          )}

          {/* ================= MODE B: LEGENDARY BLOCK SCHEMATIC (FALLBACK / TOGGLE) ================= */}
          {(viewMode === 'schematic' || !isWokwiSupported) && (
            <>
              {schematicLayout.wires.map((w) => (
                <polyline
                  key={w.id}
                  points={w.points.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke={NET_COLOUR[w.kind]}
                  strokeWidth={hoverWire === w.netId ? 3.2 : 1.6}
                  strokeLinejoin="round"
                  opacity={hoverWire && hoverWire !== w.netId ? 0.25 : 0.9}
                  onPointerEnter={() => setHoverWire(w.netId)}
                  onPointerLeave={() => setHoverWire(null)}
                >
                  <title>{w.label}</title>
                </polyline>
              ))}
              {schematicLayout.boxes.map((b) => {
                const t = TONE[b.tone]
                return (
                  <g key={b.id} onClick={() => onSelect?.(b.id)} className="cursor-pointer">
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={8}
                      fill={t.fill}
                      stroke={selected === b.id ? '#0f172a' : t.stroke}
                      strokeWidth={selected === b.id ? 2.5 : 1.3}
                    />
                    <path
                      d={`M${b.x},${b.y + 8} a8,8 0 0 1 8,-8 h${b.w - 16} a8,8 0 0 1 8,8 v18 h-${b.w} z`}
                      fill={t.head}
                    />
                    <text x={b.x + 10} y={b.y + 14} fontSize={11.5} fontWeight={700} fill="#fff">
                      {b.title}
                    </text>
                    {b.subtitle && (
                      <text x={b.x + 10} y={b.y + 26} fontSize={9.5} fill="#e2e8f0">
                        {b.subtitle.length > 40 ? `${b.subtitle.slice(0, 39)}…` : b.subtitle}
                      </text>
                    )}
                    {b.pins.map((p) => (
                      <g key={p.name}>
                        <circle cx={p.x} cy={p.y} r={3.4} fill="#fff" stroke="#334155" strokeWidth={1.2} />
                        <text
                          x={p.side === 'l' ? p.x + 8 : p.x - 8}
                          y={p.y + 3.5}
                          fontSize={10}
                          textAnchor={p.side === 'l' ? 'start' : 'end'}
                          fill="#0f172a"
                          fontFamily="ui-monospace,monospace"
                        >
                          {p.name}
                        </text>
                      </g>
                    ))}
                  </g>
                )
              })}
            </>
          )}
        </g>
      </svg>

      {/* Floating Control Bar: Zoom in, Zoom out, Fit, Reset, View Mode */}
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-slate-700/60 bg-slate-900/90 p-1 shadow-lg backdrop-blur-sm">
        <Button variant="ghost" size="iconSm" aria-label="Zoom in" className="text-slate-200 hover:bg-slate-800" onClick={() => zoom(1.25)}>
          <Plus size={14} />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="Zoom out" className="text-slate-200 hover:bg-slate-800" onClick={() => zoom(0.8)}>
          <Minus size={14} />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="Fit to screen" className="text-slate-200 hover:bg-slate-800" onClick={fit}>
          <Maximize2 size={13} />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="Reset view" className="text-slate-200 hover:bg-slate-800" onClick={resetView}>
          <RotateCcw size={13} />
        </Button>

        {isWokwiSupported && (
          <div className="border-t border-slate-700/60 pt-1">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Toggle Wokwi vs Schematic view"
              className={viewMode === 'wokwi' ? 'bg-blue-600/30 text-blue-400' : 'text-slate-300 hover:bg-slate-800'}
              onClick={() => setViewMode(viewMode === 'wokwi' ? 'schematic' : 'wokwi')}
              title={`Switch to ${viewMode === 'wokwi' ? 'Block Schematic' : 'Wokwi Electronics'} view`}
            >
              <Layers size={13} />
            </Button>
          </div>
        )}
      </div>

      {/* Header Badge: View Title and Source Confirmation */}
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/90 px-2.5 py-1 text-xs shadow-md backdrop-blur-sm">
        <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold text-slate-200">
          {viewMode === 'wokwi' && isWokwiSupported ? 'Wokwi Simulator Circuit Preview' : 'Hardware Schematic'}
        </span>
        <span className="text-[10.5px] text-slate-400 border-l border-slate-700 pl-2 font-mono">
          {viewMode === 'wokwi' && isWokwiSupported ? 'Source: diagram.json' : 'Source: Hardware Plan'}
        </span>
      </div>

      {/* Bottom Color Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-slate-700/60 bg-slate-900/90 px-3 py-1.5 text-[11px] text-slate-300 shadow-lg backdrop-blur-sm">
        <span className="font-medium text-slate-400 text-[10px] uppercase tracking-wider">Wiring:</span>
        {(viewMode === 'wokwi' && isWokwiSupported ? WOKWI_LEGEND : SCHEMATIC_LEGEND).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-1.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function pCoord(p: { x: number; y: number } | null) {
  if (!p) return null
  return <circle cx={p.x} cy={p.y} r={2} fill="#e2e8f0" stroke="#0f172a" strokeWidth={0.8} />
}

function renderWokwiPart(part: WokwiPart, selected: boolean) {
  switch (part.type) {
    case 'board-esp32-devkit-c-v4':
    case 'wokwi-esp32-devkit-v1':
      return <Esp32Artwork id={part.id} selected={selected} />
    case 'wokwi-arduino-uno':
      return <UnoArtwork selected={selected} />
    case 'wokwi-dht22':
      return <Dht22Artwork attrs={part.attrs} selected={selected} />
    case 'wokwi-photoresistor-sensor':
      return <LdrArtwork attrs={part.attrs} selected={selected} />
    case 'wokwi-pir-motion-sensor':
      return <PirArtwork selected={selected} />
    case 'wokwi-ds18b20':
      return <Ds18b20Artwork attrs={part.attrs} selected={selected} />
    case 'wokwi-resistor':
      return <ResistorArtwork attrs={part.attrs} selected={selected} />
    case 'wokwi-led':
      return <LedArtwork attrs={part.attrs} selected={selected} />
    default:
      return (
        <g>
          <rect x="0" y="0" width="50" height="30" rx="4" fill="#334155" stroke="#64748b" />
          <text x="25" y="18" fill="#e2e8f0" fontSize="7" textAnchor="middle">
            {part.id}
          </text>
        </g>
      )
  }
}
