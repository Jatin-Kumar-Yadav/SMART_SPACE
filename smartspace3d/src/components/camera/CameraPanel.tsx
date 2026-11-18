import { Camera, CheckCircle2, EyeOff, HelpCircle, Plus, Ruler, ScanSearch, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberInput, Section, SelectBox, TextInput, Toggle } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { allSeatSlots } from '@/simulation/occupancy'
import { addCamera, getRuntime, seatLabel, syncCameras, unionCommitted, useCameraUi, type CameraTab } from '@/store/cameraStore'
import { useEditor } from '@/store/editorStore'
import type { CalibrationLevel, CalibrationPoint, CameraConfig } from '@/types'
import { calibrateCamera, type CalibrationResult } from '@/vision/pose'
import type { TrackStatus } from '@/vision/pipeline'
import { FloorPlanPicker } from './FloorPlanPicker'
import { OccupancySourceControl } from './OccupancySourceControl'
import { MobilePairing, ModelNotice, PickFile, startPhone, stopPhone } from './SourcePanels'

const TABS: { id: CameraTab; label: string }[] = [
  { id: 'detect', label: 'Detect' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'cameras', label: 'Cameras' },
]

const LEVEL: Record<CalibrationLevel, { text: string; cls: string }> = {
  none: { text: 'Not calibrated', cls: 'bg-slate-100 text-slate-600' },
  poor: { text: 'Poor', cls: 'bg-red-100 text-red-700' },
  fair: { text: 'Fair', cls: 'bg-amber-100 text-amber-800' },
  good: { text: 'Good', cls: 'bg-green-100 text-green-700' },
}
const STATUS_TEXT: Record<TrackStatus, string> = { confirmed: 'Seated', uncertain: 'Uncertain', unassigned: 'No seat', standing: 'Standing', walking: 'Walking', ignored: 'Ignored' }
const STATUS_CLS: Record<TrackStatus, string> = {
  confirmed: 'bg-green-100 text-green-700', uncertain: 'bg-amber-100 text-amber-800', unassigned: 'bg-slate-100 text-slate-600',
  standing: 'bg-blue-100 text-blue-700', walking: 'bg-violet-100 text-violet-700', ignored: 'bg-red-100 text-red-700',
}

export function CameraPanel() {
  const tab = useCameraUi((s) => s.tab)
  const set = useCameraUi((s) => s.set)
  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Camera inspector">
      <div role="tablist" className="grid grid-cols-4 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => set({ tab: t.id })} className={cn('py-2.5 text-[12px] font-medium', tab === t.id ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ss-scroll min-h-0 flex-1">
        {tab === 'detect' && <DetectTab />}
        {tab === 'calibrate' && <CalibrateTab />}
        {tab === 'mapping' && <MappingTab />}
        {tab === 'cameras' && <CamerasTab />}
      </div>
    </aside>
  )
}

function useActive() {
  const space = useEditor((s) => s.space!)
  const id = useCameraUi((s) => s.activeId)
  const rs = useCameraUi((s) => (id ? s.states[id] : undefined))
  const cam = space.cameras.find((c) => c.id === id)
  return { space, id, rs, cam, rt: id ? getRuntime(id) : undefined }
}

// ───────────────────────── Detect ─────────────────────────
function DetectTab() {
  const { space, rs, rt } = useActive()
  const selected = useCameraUi((s) => s.selectedTrack)
  const ui = useCameraUi((s) => s.set)
  const seats = useMemo(() => allSeatSlots(space.objects), [space.objects])
  const r = rs?.result
  const taken = new Set(r?.tracks.filter((t) => t.seatKey && t.status !== 'ignored').map((t) => t.seatKey))
  const kind = rs?.kind ?? 'none'

  return (
    <>
      <Section title="Source">
        <div className="text-[12px] text-slate-600">{kind === 'none' ? 'No source loaded.' : <><b>{rs?.label}</b>{rs?.frameSize ? ` · ${rs.frameSize[0]}×${rs.frameSize[1]}` : ''}</>}</div>
        <div className="flex flex-wrap gap-1.5">
          <PickFile kind="image" size="sm">Image…</PickFile>
          <PickFile kind="video" size="sm">Video…</PickFile>
          <Button size="sm" onClick={() => void startPhone()}>Phone</Button>
          {kind !== 'none' && <Button size="sm" variant="ghost" onClick={() => (kind === 'mobile' ? stopPhone() : rt?.reset())}>Reset</Button>}
        </div>
        {kind === 'mobile' && rs?.mobile.status !== 'streaming' && <MobilePairing />}
        <ModelNotice compact />
        {rs?.inferenceMs != null && <p className="text-[11px] text-slate-400">Last detection: {Math.round(rs.inferenceMs)} ms</p>}
      </Section>

      <Section title="Result" right={<Button size="sm" variant="ghost" disabled={kind === 'none'} onClick={() => void rt?.analyzeOnce()}><ScanSearch size={13} />Analyze</Button>}>
        {!r ? (
          <p className="text-[12px] text-slate-500">Nothing analysed yet. Calibrate the camera, then press <b>Analyze</b>. Boxes are never invented: with no model loaded only hand-drawn boxes are used.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {([['People', r.stats.people], ['Seated', r.stats.sitting], ['Counted', r.committed.length], ['Standing', r.stats.standing], ['Uncertain', r.stats.uncertain], ['No seat', r.stats.unassigned]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border border-slate-200 px-1 py-1.5"><div className="text-base font-semibold text-slate-800">{v}</div><div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div></div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-600">
              <span>Occupancy confidence</span>
              <b className={cn(r.stats.meanConfidence == null ? 'text-slate-400' : r.stats.meanConfidence > 0.75 ? 'text-green-700' : 'text-amber-700')}>{r.stats.meanConfidence == null ? 'n/a' : `${Math.round(r.stats.meanConfidence * 100)}%`}</b>
            </div>
            {r.stats.unobservedSeats > 0 && <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11.5px] text-slate-600">{r.stats.unobservedSeats} seat{r.stats.unobservedSeats === 1 ? '' : 's'} cannot be seen from this camera. Their occupancy is unknown and counted as empty.</p>}
            {r.warnings.map((w) => <p key={w} className="rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800">{w}</p>)}
          </>
        )}
      </Section>

      {r && (
        <Section title={`Detected people (${r.tracks.length})`}>
          {r.tracks.length === 0 && <p className="text-[12px] text-slate-500">No people found in this frame.</p>}
          <ul className="flex flex-col gap-1.5">
            {r.tracks.map((t) => (
              <li key={t.id} className={cn('rounded-lg border p-2', selected === t.id ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200')}>
                <button className="flex w-full items-center justify-between text-left" onClick={() => ui({ selectedTrack: selected === t.id ? null : t.id })}>
                  <span className="text-[12.5px] font-medium text-slate-800">#{t.id} <span className="font-normal text-slate-500">{t.drawn ? 'drawn by hand' : `${Math.round(t.score * 100)}% detection`}</span></span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATUS_CLS[t.status])}>{STATUS_TEXT[t.status]}</span>
                </button>
                {selected === t.id && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Field label="Seat" hint={t.seatKey ? `${Math.round(t.confidence * 100)}% match${t.manual ? ' · set by you' : ''}` : 'Pick the 3D seat this person occupies'}>
                      <SelectBox
                        value={t.seatKey ?? ''}
                        onChange={(v) => { rt?.pipeline.assignManually(t.id, v || null); rt?.reevaluate() }}
                        options={[{ value: '', label: '— no seat —' }, ...seats.filter((s) => s.key === t.seatKey || !taken.has(s.key)).map((s) => ({ value: s.key, label: seatLabel(s.key) }))]}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => { rt?.pipeline.markUncertain(t.id, t.status !== 'uncertain'); rt?.reevaluate() }}><HelpCircle size={12} />{t.status === 'uncertain' ? 'Clear uncertain' : 'Mark uncertain'}</Button>
                      <Button size="sm" variant={t.status === 'ignored' ? 'secondary' : 'danger'} onClick={() => { rt?.pipeline.ignoreTrack(t.id, t.status !== 'ignored'); rt?.reevaluate() }}>
                        {t.status === 'ignored' ? <><Undo2 size={12} />Restore</> : <><EyeOff size={12} />Ignore (false detection)</>}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

// ───────────────────────── Calibrate ─────────────────────────
function CalibrateTab() {
  const { space, cam, rs, rt } = useActive()
  const selected = useCameraUi((s) => s.selectedPoint)
  const ui = useCameraUi((s) => s.set)
  const upsert = useEditor((s) => s.upsertCamera)
  const [fovAuto, setFovAuto] = useState(true)
  const [res, setRes] = useState<CalibrationResult | null>(null)

  if (!cam) {
    return (
      <Section title="Calibration">
        <p className="text-[12px] text-slate-600">Calibration links pixels in the camera image to positions in the 3D room. Load a source, choose the crosshair tool on the image, and click room corners or seat legs.</p>
        <Button size="sm" onClick={() => addCamera()}><Plus size={13} />Add camera</Button>
      </Section>
    )
  }
  const patchPoint = (i: number, fn: (p: CalibrationPoint) => CalibrationPoint) => upsert({ ...cam, points: cam.points.map((p, k) => (k === i ? fn(p) : p)), updatedAt: Date.now() })
  const solve = () => {
    const r = calibrateCamera(cam.points, cam.imageSize, fovAuto ? 'auto' : cam.hFovDeg)
    setRes(r)
    if (!r.ok) return
    upsert({ ...cam, homography: r.homography as number[], pose: { position: r.pose!.position, rotation: r.pose!.rotation as number[] }, hFovDeg: r.hFovDeg ?? cam.hFovDeg, reprojectionErrorPx: r.reprojectionErrorPx, level: r.level, updatedAt: Date.now() })
    syncCameras()
    void rt?.reevaluate()
  }
  const lv = LEVEL[cam.level]
  const floorPts = cam.points.filter((p) => Math.abs(p.world[1]) < 0.05).length
  const marks = cam.points.map((p, i) => ({ x: p.world[0], z: p.world[2], label: String(i + 1), active: i === selected }))

  return (
    <>
      <Section title="Calibration" right={<span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', lv.cls)}>{lv.text}</span>}>
        <p className="text-[12px] leading-snug text-slate-600">
          A single image cannot reveal where the camera is. Click at least <b>4 floor points</b> (room corners, seat legs) on the image with the crosshair tool, say where each is in the room, then press <b>Calibrate</b>. 6+ well-spread points let the app check its own accuracy.
        </p>
        {!rs?.frameSize && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800">Load an image or video first, then pick points on it.</p>}
        <div className="flex items-center justify-between">
          <Toggle checked={fovAuto} onChange={setFovAuto} label="Estimate field of view" />
        </div>
        {!fovAuto && <Field label="Horizontal field of view" hint="Phone main camera ≈ 65–80°"><NumberInput value={cam.hFovDeg} step={1} min={20} max={140} suffix="°" onCommit={(v) => upsert({ ...cam, hFovDeg: v, updatedAt: Date.now() })} /></Field>}
        <div className="flex gap-1.5">
          <Button size="sm" onClick={solve} disabled={floorPts < 4}><Ruler size={13} />Calibrate ({floorPts}/4+ floor points)</Button>
          <Button size="sm" variant="ghost" disabled={!cam.points.length} onClick={() => { upsert({ ...cam, points: [], homography: undefined, pose: undefined, reprojectionErrorPx: undefined, level: 'none', updatedAt: Date.now() }); setRes(null); ui({ selectedPoint: null }); syncCameras(); void rt?.reevaluate() }}><Trash2 size={13} />Clear</Button>
        </div>
        {res && !res.ok && <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11.5px] text-red-700" role="alert">{res.error}</p>}
        {res?.warnings.map((w) => <p key={w} className="rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800">{w}</p>)}
        {cam.pose && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md bg-slate-50 p-2 text-[11.5px] text-slate-600">
            <dt>Camera position</dt><dd className="text-right font-mono">{cam.pose.position.map((v) => v.toFixed(1)).join(', ')} m</dd>
            <dt>Field of view</dt><dd className="text-right font-mono">{cam.hFovDeg.toFixed(0)}°{res?.fovEstimated ? ' (estimated)' : ''}</dd>
            <dt>Reprojection error</dt><dd className="text-right font-mono">{cam.reprojectionErrorPx?.toFixed(1) ?? '–'} px</dd>
          </dl>
        )}
      </Section>

      <Section title={`Points (${cam.points.length})`}>
        {cam.points.length === 0 && <p className="text-[12px] text-slate-500">No points yet. Choose the crosshair tool above the image and click a room corner.</p>}
        {cam.points.map((p, i) => (
          <div key={i} className={cn('rounded-lg border p-2', i === selected ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200')} onClick={() => ui({ selectedPoint: i })}>
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <b>Point {i + 1}</b>
              <span className="font-mono text-[11px] text-slate-500">px {p.image[0]}, {p.image[1]}</span>
              <button aria-label={`Delete point ${i + 1}`} className="text-slate-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); upsert({ ...cam, points: cam.points.filter((_, k) => k !== i), updatedAt: Date.now() }); ui({ selectedPoint: null }) }}><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Field label="X (m)"><NumberInput value={p.world[0]} step={0.1} min={0} max={space.dims.length} onCommit={(v) => patchPoint(i, (q) => ({ ...q, world: [v, q.world[1], q.world[2]] }))} /></Field>
              <Field label="Height (m)"><NumberInput value={p.world[1]} step={0.1} min={0} max={space.dims.height} onCommit={(v) => patchPoint(i, (q) => ({ ...q, world: [q.world[0], v, q.world[2]] }))} /></Field>
              <Field label="Z (m)"><NumberInput value={p.world[2]} step={0.1} min={0} max={space.dims.width} onCommit={(v) => patchPoint(i, (q) => ({ ...q, world: [q.world[0], q.world[1], v] }))} /></Field>
            </div>
          </div>
        ))}
        {selected != null && cam.points[selected] && (
          <div>
            <p className="mb-1 text-[11.5px] text-slate-500">Click the plan to place <b>point {selected + 1}</b> in the room (snaps to corners and seats).</p>
            <FloorPlanPicker marks={marks} onPick={(x, z) => patchPoint(selected, (q) => ({ ...q, world: [x, q.world[1], z] }))} />
          </div>
        )}
      </Section>
    </>
  )
}

// ───────────────────────── Mapping ─────────────────────────
function MappingTab() {
  const { space, rt } = useActive()
  const showSeats = useCameraUi((s) => s.showSeats)
  const showFrustum = useCameraUi((s) => s.showFrustum)
  const ui = useCameraUi((s) => s.set)
  const states = useCameraUi((s) => s.states)
  const seats = unionCommitted(Date.now(), Infinity)
  void states
  return (
    <>
      <Section title="Occupancy source"><OccupancySourceControl /></Section>
      <Section title="Display">
        <Toggle checked={showSeats} onChange={(v) => ui({ showSeats: v })} label="Project seats onto the image" />
        <Toggle checked={showFrustum} onChange={(v) => ui({ showFrustum: v })} label="Show camera and field of view in 3D" />
      </Section>
      <Section title={`Seats seen occupied (${seats.length})`}>
        {seats.length === 0 && <p className="text-[12px] text-slate-500">No seat is confirmed yet. A seat counts after a person is seen in it consistently; one frame never changes the room.</p>}
        <ul className="flex flex-col gap-1">
          {seats.map((k) => (
            <li key={k} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1 text-[12px]">
              <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-green-600" />{seatLabel(k)}</span>
              <button className="text-[11px] text-slate-500 underline hover:text-red-600" onClick={() => { rt?.pipeline.forceSeat(k, 'vacant'); rt?.reevaluate() }}>Mark empty</button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-400">{space.objects.length ? `${allSeatSlots(space.objects).length} seats in the room.` : ''}</p>
      </Section>
    </>
  )
}

// ───────────────────────── Cameras ─────────────────────────
function CamerasTab() {
  const space = useEditor((s) => s.space!)
  const upsert = useEditor((s) => s.upsertCamera)
  const remove = useEditor((s) => s.removeCamera)
  const activeId = useCameraUi((s) => s.activeId)
  const states = useCameraUi((s) => s.states)
  const ui = useCameraUi((s) => s.set)
  return (
    <Section title={`Cameras (${space.cameras.length})`} right={<Button size="sm" variant="ghost" onClick={() => addCamera()}><Plus size={13} />Add</Button>}>
      <p className="text-[11.5px] text-slate-500">Each camera has its own calibration, stored with the project. A person seen by two cameras occupies one seat, never two.</p>
      {space.cameras.length === 0 && <p className="text-[12px] text-slate-500">No camera yet. One is created when you load a source.</p>}
      {space.cameras.map((c: CameraConfig) => {
        const st = states[c.id]
        return (
          <div key={c.id} className={cn('rounded-lg border p-2', c.id === activeId ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200')}>
            <div className="flex items-center gap-2">
              <Camera size={14} className="text-slate-500" />
              <TextInput value={c.name} onCommit={(v) => upsert({ ...c, name: v || c.name, updatedAt: Date.now() })} className="min-w-0 flex-1" />
              <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', LEVEL[c.level].cls)}>{LEVEL[c.level].text}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-slate-500">
              <span>{st?.kind && st.kind !== 'none' ? `${st.label || st.kind} · ${st.result?.committed.length ?? 0} seats` : 'No source'}</span>
              <span className="flex gap-1">
                {c.id !== activeId && <Button size="sm" variant="ghost" onClick={() => ui({ activeId: c.id })}>Use</Button>}
                <Button size="sm" variant="ghost" onClick={() => { remove(c.id); syncCameras() }}><Trash2 size={12} /></Button>
              </span>
            </div>
          </div>
        )
      })}
    </Section>
  )
}
