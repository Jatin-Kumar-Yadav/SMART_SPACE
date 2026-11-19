import { Film, Image as ImageIcon, Loader2, QrCode, RefreshCw, Smartphone, Square, Upload } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ensureActiveCamera, ensureDetector, getRuntime, loadModelFromFile, useCameraUi } from '@/store/cameraStore'
import { toast } from '@/store/uiStore'
import { phoneUrl, type HostStatus } from '@/vision/webrtc'

/** The runtime of the active camera (the camera is created on first use). */
function runtimeOf(): NonNullable<ReturnType<typeof getRuntime>> | undefined {
  return getRuntime(ensureActiveCamera())
}

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
const VIDEO_TYPES = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov'

/** Load a picked file into the active camera. Returns false when the type is not accepted. */
async function openMediaFile(file: File, as: 'image' | 'video' | 'auto' = 'auto'): Promise<boolean> {
  const rt = runtimeOf()
  if (!rt) return false
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name)
  if ((as === 'image' || as === 'auto') && isImage) {
    await rt.loadImage(file, file.name)
    return true
  }
  if ((as === 'video' || as === 'auto') && isVideo) {
    await rt.loadVideo(file, file.name)
    return true
  }
  toast(as === 'image' ? 'Choose a JPG, PNG or WEBP image.' : as === 'video' ? 'Choose an MP4, WEBM or MOV video.' : 'Unsupported file. Use JPG/PNG/WEBP images or MP4/WEBM/MOV video.', 'warning')
  return false
}

/** Button + hidden input pair for one kind of media. */
export function PickFile({ kind, children, variant = 'secondary', size = 'default', className }: { kind: 'image' | 'video'; children: React.ReactNode; variant?: 'default' | 'secondary' | 'ghost'; size?: 'default' | 'sm'; className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) await openMediaFile(f, kind)
        }}
      />
      <Button variant={variant} size={size} className={className} onClick={() => input.current?.click()}>
        {children}
      </Button>
    </>
  )
}

const MOBILE_TEXT: Record<HostStatus, string> = {
  idle: 'Not started',
  'connecting-server': 'Connecting to the SmartSpace backend…',
  'waiting-for-phone': 'Waiting for the phone to open the link…',
  negotiating: 'Phone connected. Waiting for it to start the camera…',
  streaming: 'Streaming from the phone',
  'phone-left': 'The phone disconnected',
  stopped: 'Stopped',
  error: 'Error',
}

/** Pairing for a phone camera: QR code + link + status + Stop. The phone user must grant camera access. */
export function MobilePairing() {
  const id = useCameraUi((s) => s.activeId)
  const m = useCameraUi((s) => (id ? s.states[id]?.mobile : undefined))
  const [qr, setQr] = useState<string | null>(null)
  const [lan, setLan] = useState<string | undefined>()
  const [url, setUrl] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { lan?: { address: string }[] } | null) => alive && setLan(j?.lan?.[0]?.address))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [m?.session])

  useEffect(() => {
    if (!m?.session) {
      setQr(null)
      setUrl('')
      return
    }
    const u = phoneUrl(m.session, window.location.origin, lan)
    setUrl(u)
    QRCode.toDataURL(u, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null))
  }, [m?.session, lan])

  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname)
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Smartphone size={16} />Connect a phone camera</div>
      {m?.status === 'error' && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{m.detail ?? 'Could not connect.'}</p>}
      {qr ? <img src={qr} alt="QR code for the phone link" className="h-48 w-48 rounded-md border border-slate-200" /> : <div className="grid h-48 w-48 place-items-center rounded-md border border-dashed border-slate-300 text-slate-400">{m?.status === 'error' ? <QrCode size={28} /> : <Loader2 className="animate-spin" size={22} />}</div>}
      <ol className="list-decimal space-y-0.5 pl-4 text-left text-[12px] text-slate-600">
        <li>Put the phone on the same Wi-Fi as this computer.</li>
        <li>Scan the code (or open the link) on the phone and accept the one-time certificate warning.</li>
        <li>On the phone tap <b>Start camera</b> and allow camera access. Nothing starts without that.</li>
      </ol>
      {local && <p className="rounded-md bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">This page is open on <b>localhost</b>. The link uses this computer&apos;s Wi-Fi address{lan ? ` (${lan})` : ''} so the phone can reach it.</p>}
      {url && <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Phone link" className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center font-mono text-[11px] text-slate-600" />}
      <div className={cn('flex items-center gap-1.5 text-xs', m?.status === 'streaming' ? 'text-green-700' : 'text-slate-500')}>
        <span className={cn('h-2 w-2 rounded-full', m?.status === 'streaming' ? 'bg-green-500' : m?.status === 'error' ? 'bg-red-500' : 'animate-pulse bg-amber-400')} />
        {m ? MOBILE_TEXT[m.status] : ''}{m?.info?.facing ? ` · ${m.info.facing === 'user' ? 'front' : 'rear'} camera` : ''}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => void startPhone()}><RefreshCw size={13} />New link</Button>
        <Button variant="danger" size="sm" onClick={() => stopPhone()}><Square size={12} />Stop</Button>
      </div>
    </div>
  )
}

export async function startPhone() {
  const rt = runtimeOf()
  if (!rt) return
  try {
    await rt.startMobile()
  } catch {
    /* the runtime shows the error */
  }
}

export function stopPhone() {
  const id = useCameraUi.getState().activeId
  const rt = id ? getRuntime(id) : undefined
  rt?.stopMobile()
  rt?.reset()
}

/** Explains the model state and offers the two ways to provide it. */
export function ModelNotice({ compact = false }: { compact?: boolean }) {
  const d = useCameraUi((s) => s.detector)
  const pick = useRef<HTMLInputElement>(null)
  if (d.state === 'ready') return compact ? null : <p className="text-[11.5px] text-green-700">Person model ready · {d.name}</p>
  if (d.state === 'loading') return <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500"><Loader2 size={12} className="animate-spin" />{d.message}</p>
  if (d.state === 'idle') {
    return (
      <p className="text-[11.5px] text-slate-500">
        The person model loads when you first analyse. <button className="text-blue-600 underline" onClick={() => void ensureDetector()}>Load it now</button>
      </p>
    )
  }
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] text-amber-900">
      <p className="font-medium">{d.state === 'missing' ? 'Person-detection model not installed' : 'Person-detection model failed to load'}</p>
      <p className="mt-0.5 break-words">{d.message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input ref={pick} type="file" accept=".onnx" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await loadModelFromFile(f) }} />
        <Button size="sm" variant="secondary" onClick={() => pick.current?.click()}><Upload size={12} />Choose .onnx file</Button>
        <Button size="sm" variant="ghost" onClick={() => void ensureDetector()}><RefreshCw size={12} />Retry</Button>
      </div>
      <p className="mt-1.5 text-amber-800/80">Until then, you can still draw person boxes by hand and map them to seats.</p>
    </div>
  )
}

/** Centre of the feed area while no media is loaded (and while a phone is being paired). */
export function SourceEmptyState() {
  const id = useCameraUi((s) => s.activeId)
  const kind = useCameraUi((s) => (id ? s.states[id]?.kind : 'none'))
  const error = useCameraUi((s) => (id ? s.states[id]?.error : null))
  const [over, setOver] = useState(false)

  if (kind === 'mobile') {
    return <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-slate-100 p-4"><MobilePairing /></div>
  }
  return (
    <div
      className={cn('grid min-h-0 flex-1 place-items-center overflow-auto bg-slate-100 p-6', over && 'ring-2 ring-inset ring-blue-400')}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) await openMediaFile(f) }}
    >
      <div className="flex w-full max-w-xl flex-col gap-3">
        <div className="text-center">
          <h2 className="text-base font-semibold text-slate-800">Choose a camera source</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Frames stay in this browser. Raw video is never stored or uploaded. Drop a file here, or pick a source.</p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <ImageIcon className="text-blue-600" size={22} />
            <div className="text-[13px] font-medium">Image</div>
            <div className="text-[11px] text-slate-500">JPG · PNG · WEBP</div>
            <PickFile kind="image" variant="default" size="sm"><Upload size={12} />Upload</PickFile>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <Film className="text-blue-600" size={22} />
            <div className="text-[13px] font-medium">Video</div>
            <div className="text-[11px] text-slate-500">MP4 · WEBM · MOV*</div>
            <PickFile kind="video" variant="default" size="sm"><Upload size={12} />Upload</PickFile>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <Smartphone className="text-blue-600" size={22} />
            <div className="text-[13px] font-medium">Phone camera</div>
            <div className="text-[11px] text-slate-500">Live, over Wi-Fi</div>
            <Button size="sm" onClick={() => void startPhone()}><QrCode size={12} />Pair phone</Button>
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-400">*MOV plays only where the browser supports its codec.</p>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-xs text-red-700">{error}</p>}
        <ModelNotice />
      </div>
    </div>
  )
}
