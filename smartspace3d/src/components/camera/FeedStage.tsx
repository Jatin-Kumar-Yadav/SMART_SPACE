import { Crosshair, Eye, MousePointer2, Pause, Play, ScanSearch, SquareDashedMousePointer, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ensureActiveCamera, getRuntime, seatLabel, useCameraUi, type StageTool } from '@/store/cameraStore'
import { useEditor } from '@/store/editorStore'
import type { CalibrationPoint, CameraConfig, Space, Vec2, Vec3 } from '@/types'
import type { BBox } from '@/vision/geometry'
import type { TrackStatus } from '@/vision/pipeline'
import { SourceEmptyState } from './SourcePanels'

const STATUS_COLOR: Record<TrackStatus, string> = {
  confirmed: '#16a34a',
  uncertain: '#d97706',
  unassigned: '#64748b',
  standing: '#2563eb',
  walking: '#7c3aed',
  ignored: '#dc2626',
}

/** Default world position offered for the next clicked point: the four room corners first. */
export function nextWorldPoint(existing: CalibrationPoint[], dims: Space['dims']): Vec3 {
  const { length: L, width: W } = dims
  const corners: Vec3[] = [[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W], [L / 2, 0, W / 2], [L / 2, 0, 0], [L / 2, 0, W], [0, 0, W / 2], [L, 0, W / 2]]
  const used = (c: Vec3) => existing.some((p) => Math.abs(p.world[0] - c[0]) < 1e-6 && Math.abs(p.world[2] - c[2]) < 1e-6 && Math.abs(p.world[1] - c[1]) < 1e-6)
  return corners.find((c) => !used(c)) ?? [L / 2, 0, W / 2]
}

const TOOLS: { id: StageTool; label: string; Icon: typeof MousePointer2 }[] = [
  { id: 'view', label: 'Select people and seats', Icon: MousePointer2 },
  { id: 'calibrate', label: 'Pick calibration points on the image', Icon: Crosshair },
  { id: 'draw', label: 'Draw a person box by hand', Icon: SquareDashedMousePointer },
]

export function FeedStage() {
  const space = useEditor((s) => s.space!)
  const upsertCamera = useEditor((s) => s.upsertCamera)
  const id = useCameraUi((s) => s.activeId)
  const rs = useCameraUi((s) => (id ? s.states[id] : undefined))
  const tool = useCameraUi((s) => s.tool)
  const showSeats = useCameraUi((s) => s.showSeats)
  const selectedTrack = useCameraUi((s) => s.selectedTrack)
  const selectedPoint = useCameraUi((s) => s.selectedPoint)
  const ui = useCameraUi((s) => s.set)
  const rt = id ? getRuntime(id) : undefined
  const cam = space.cameras.find((c) => c.id === id)

  const holder = useRef<HTMLDivElement>(null)
  const videoHost = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<{ kind: 'point'; idx: number; pos: Vec2 } | { kind: 'box'; a: Vec2; b: Vec2 } | null>(null)
  const frame = rs?.frameSize ?? null
  const kind = rs?.kind ?? 'none'

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setAvail({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [kind])

  // still image → canvas
  useEffect(() => {
    if (kind !== 'image' || !rt?.bitmap || !canvas.current) return
    const c = canvas.current
    c.width = rt.bitmap.width
    c.height = rt.bitmap.height
    c.getContext('2d')?.drawImage(rt.bitmap, 0, 0)
  }, [kind, rt, rs?.label, frame, avail.w, avail.h]) // avail: the canvas only exists once the stage has a size

  // video / phone → persistent <video> element owned by the runtime
  useEffect(() => {
    const host = videoHost.current
    const v = rt?.video
    if (!host || !v || (kind !== 'video' && kind !== 'mobile')) return
    v.className = 'block h-full w-full object-fill bg-black'
    host.appendChild(v)
    return () => {
      if (v.parentNode === host) host.removeChild(v)
    }
  }, [rt, kind, frame])

  const disp = useMemo(() => {
    if (!frame || !avail.w || !avail.h) return null
    const s = Math.min(avail.w / frame[0], avail.h / frame[1])
    return { w: frame[0] * s, h: frame[1] * s, k: 1 / s }
  }, [frame, avail])

  if (!rs || kind === 'none' || !frame) {
    return <SourceEmptyState />
  }

  const calSize = cam?.imageSize ?? frame
  const sx = frame[0] / calSize[0]
  const sy = frame[1] / calSize[1]
  const toFrame = (b: BBox): BBox => [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy]
  const result = rs.result
  const committed = new Set(result?.committed ?? [])
  const k = disp?.k ?? 1

  const pointer = (e: React.PointerEvent): Vec2 => {
    const r = svg.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(frame[0], ((e.clientX - r.left) / r.width) * frame[0])), Math.max(0, Math.min(frame[1], ((e.clientY - r.top) / r.height) * frame[1]))]
  }

  const withCamera = (fn: (c: CameraConfig) => CameraConfig) => {
    const cid = ensureActiveCamera()
    const c = useEditor.getState().space!.cameras.find((x) => x.id === cid)!
    upsertCamera(fn(c))
  }

  const onBackground = (e: React.PointerEvent) => {
    const p = pointer(e)
    if (tool === 'calibrate') {
      withCamera((c) => {
        const size: Vec2 = c.points.length === 0 ? frame : c.imageSize
        const img: Vec2 = [Math.round((p[0] * size[0]) / frame[0]), Math.round((p[1] * size[1]) / frame[1])]
        ui({ selectedPoint: c.points.length })
        return { ...c, imageSize: size, points: [...c.points, { image: img, world: nextWorldPoint(c.points, space.dims) }], updatedAt: Date.now() }
      })
    } else if (tool === 'draw') {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDrag({ kind: 'box', a: p, b: p })
    } else {
      ui({ selectedTrack: null })
    }
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = pointer(e)
    setDrag(drag.kind === 'box' ? { ...drag, b: p } : { ...drag, pos: p })
  }
  const onUp = () => {
    if (!drag) return
    if (drag.kind === 'box') {
      const x = Math.min(drag.a[0], drag.b[0])
      const y = Math.min(drag.a[1], drag.b[1])
      const w = Math.abs(drag.a[0] - drag.b[0])
      const h = Math.abs(drag.a[1] - drag.b[1])
      if (w > frame[0] * 0.01 && h > frame[1] * 0.02) void rt?.addManualBox([x * (calSize[0] / frame[0]) , y * (calSize[1] / frame[1]), w * (calSize[0] / frame[0]), h * (calSize[1] / frame[1])] as BBox)
    } else {
      const { idx, pos } = drag
      withCamera((c) => ({ ...c, points: c.points.map((pt, i) => (i === idx ? { ...pt, image: [Math.round((pos[0] * c.imageSize[0]) / frame[0]), Math.round((pos[1] * c.imageSize[1]) / frame[1])] as Vec2 } : pt)), updatedAt: Date.now() }))
    }
    setDrag(null)
  }

  const labelFont = 12 * k
  const label = (x: number, y: number, text: string, color: string) => (
    <text x={x} y={y} fontSize={labelFont} fontWeight={700} fill={color} stroke="#fff" strokeWidth={3 * k} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{text}</text>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-900/95">
      <div className="flex items-center gap-1 border-b border-white/10 bg-slate-900 px-2 py-1.5 text-slate-200">
        {TOOLS.map(({ id: t, label: l, Icon }) => (
          <Tip key={t} label={l}>
            <button aria-label={l} aria-pressed={tool === t} onClick={() => ui({ tool: t })} className={cn('grid h-7 w-7 place-items-center rounded-md', tool === t ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10')}>
              <Icon size={15} />
            </button>
          </Tip>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <Tip label="Show the room's seats projected into this view">
          <button aria-label="Show seats" aria-pressed={showSeats} onClick={() => ui({ showSeats: !showSeats })} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[11px]', showSeats ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/10')}>
            <Eye size={13} />Seats
          </button>
        </Tip>
        <span className="ml-1 truncate text-[11px] text-slate-400">{rs.label} · {frame[0]}×{frame[1]}</span>
        <div className="ml-auto flex items-center gap-1">
          {rs.manualBoxes > 0 && <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10" onClick={() => void rt?.clearManualBoxes()}><Trash2 size={13} />Drawn boxes ({rs.manualBoxes})</Button>}
          <Button size="sm" variant="default" onClick={() => void rt?.analyzeOnce()} disabled={rs.analyzing && kind !== 'image'}>
            <ScanSearch size={13} />{kind === 'image' ? 'Analyze image' : 'Analyze this frame'}
          </Button>
        </div>
      </div>

      <div ref={holder} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        {disp && (
          <div className="relative shadow-2xl" style={{ width: disp.w, height: disp.h }}>
            {kind === 'image' ? <canvas ref={canvas} className="block h-full w-full" /> : <div ref={videoHost} className="h-full w-full" />}
            <svg
              ref={svg}
              viewBox={`0 0 ${frame[0]} ${frame[1]}`}
              className={cn('absolute inset-0 h-full w-full touch-none', tool === 'calibrate' ? 'cursor-crosshair' : tool === 'draw' ? 'cursor-crosshair' : 'cursor-default')}
              onPointerDown={(e) => e.target === e.currentTarget && onBackground(e)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              aria-label="Camera overlay"
            >
              <rect x={0} y={0} width={frame[0]} height={frame[1]} fill="transparent" onPointerDown={onBackground} />
              {showSeats && result?.seatProjections.filter((p) => p.visible).map((p) => {
                const b = toFrame(p.box)
                const occ = committed.has(p.key)
                return (
                  <g key={p.key} onPointerDown={(e) => {
                    if (selectedTrack != null && rt) {
                      e.stopPropagation()
                      rt.pipeline.assignManually(selectedTrack, p.key)
                      rt.reevaluate()
                    }
                  }}>
                    <rect x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill={occ ? 'rgba(34,197,94,.22)' : 'rgba(148,163,184,.06)'} stroke={occ ? '#22c55e' : '#cbd5e1'} strokeOpacity={occ ? 0.95 : 0.55} strokeWidth={(occ ? 2 : 1) * k} strokeDasharray={occ ? undefined : `${4 * k} ${3 * k}`} style={{ cursor: selectedTrack != null ? 'pointer' : undefined }} />
                  </g>
                )
              })}
              {result?.tracks.map((t) => {
                const b = toFrame(t.bbox)
                const c = STATUS_COLOR[t.status]
                const sel = selectedTrack === t.id
                return (
                  <g key={t.id} onPointerDown={(e) => { e.stopPropagation(); ui({ selectedTrack: t.id, tab: 'detect' }) }} style={{ cursor: 'pointer' }}>
                    <rect x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill={sel ? `${c}33` : 'transparent'} stroke={c} strokeWidth={(sel ? 3.5 : 2.2) * k} strokeDasharray={t.status === 'ignored' || t.drawn ? `${6 * k} ${4 * k}` : undefined} opacity={t.status === 'ignored' ? 0.55 : 1} />
                    {label(b[0] + 3 * k, b[1] - 5 * k, `#${t.id} ${t.drawn ? 'drawn' : `${Math.round(t.score * 100)}%`}${t.seatKey ? ` → ${seatLabel(t.seatKey)}` : ` · ${t.status}`}`, c)}
                  </g>
                )
              })}
              {cam?.points.map((p, i) => {
                const live = drag?.kind === 'point' && drag.idx === i ? drag.pos : ([p.image[0] * sx, p.image[1] * sy] as Vec2)
                const sel = selectedPoint === i
                return (
                  <g key={i} onPointerDown={(e) => {
                    e.stopPropagation()
                    ui({ selectedPoint: i, tab: 'calibrate' })
                    if (tool === 'calibrate') {
                      ;(e.target as Element).setPointerCapture?.(e.pointerId)
                      setDrag({ kind: 'point', idx: i, pos: live })
                    }
                  }} style={{ cursor: tool === 'calibrate' ? 'move' : 'pointer' }}>
                    <circle cx={live[0]} cy={live[1]} r={9 * k} fill={sel ? '#2563eb' : '#f59e0b'} stroke="#fff" strokeWidth={2 * k} />
                    <text x={live[0]} y={live[1] + 4 * k} textAnchor="middle" fontSize={11 * k} fontWeight={800} fill="#fff" style={{ pointerEvents: 'none' }}>{i + 1}</text>
                  </g>
                )
              })}
              {drag?.kind === 'box' && <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.a[0] - drag.b[0])} height={Math.abs(drag.a[1] - drag.b[1])} fill="rgba(37,99,235,.15)" stroke="#2563eb" strokeWidth={2 * k} strokeDasharray={`${5 * k} ${3 * k}`} />}
            </svg>
          </div>
        )}
      </div>

      {kind === 'video' && rt?.video && <VideoBar rt={rt} />}
      {(rs.error || result?.warnings.length) ? (
        <div className="border-t border-white/10 bg-slate-900 px-3 py-1.5 text-[11.5px] text-amber-300">{[rs.error, ...(result?.warnings ?? [])].filter(Boolean).join('  ·  ')}</div>
      ) : null}
    </div>
  )
}

function fmt(t: number) {
  if (!Number.isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

function VideoBar({ rt }: { rt: NonNullable<ReturnType<typeof getRuntime>> }) {
  const v = rt.video!
  const [t, setT] = useState(v.currentTime)
  const [playing, setPlaying] = useState(!v.paused)
  const analyzing = useCameraUi((s) => s.states[rt.id]?.analyzing)
  useEffect(() => {
    const up = () => { setT(v.currentTime); setPlaying(!v.paused) }
    for (const ev of ['timeupdate', 'play', 'pause', 'seeked', 'ended']) v.addEventListener(ev, up)
    return () => { for (const ev of ['timeupdate', 'play', 'pause', 'seeked', 'ended']) v.removeEventListener(ev, up) }
  }, [v])
  return (
    <div className="flex items-center gap-2 border-t border-white/10 bg-slate-900 px-3 py-2 text-slate-200">
      <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (v.paused ? void v.play() : v.pause())}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
      <input type="range" aria-label="Timeline" className="min-w-0 flex-1 accent-blue-500" min={0} max={Math.max(0.1, v.duration || 0)} step={0.04} value={t} onChange={(e) => { v.currentTime = Number(e.target.value); setT(v.currentTime) }} />
      <span className="w-20 text-right font-mono text-[11px] text-slate-400">{fmt(t)} / {fmt(v.duration)}</span>
      {analyzing ? (
        <Button size="sm" variant="secondary" onClick={() => { rt.stopLoop(); v.pause() }}>Stop analysis</Button>
      ) : (
        <Button size="sm" variant="default" onClick={() => void rt.analyzeVideo()}><ScanSearch size={13} />Analyze video</Button>
      )}
    </div>
  )
}
