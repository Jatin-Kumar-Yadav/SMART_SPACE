import { Camera, CameraOff, SwitchCamera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PhoneCameraSender } from '@/vision/webrtc'

type Facing = 'user' | 'environment'

/**
 * The page the phone opens from the QR code. It cannot start the camera by itself: the person must
 * tap "Start camera" and answer the browser's permission prompt. While the camera is on, a red
 * indicator and a Stop button stay on screen.
 */
export function PhonePage({ session }: { session: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const sender = useRef<PhoneCameraSender | null>(null)
  const [facing, setFacing] = useState<Facing>('environment')
  const [on, setOn] = useState(false)
  const [status, setStatus] = useState('Ready. Nothing is recorded or uploaded; video goes straight to your computer.')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => sender.current?.stop(), [])

  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia

  const grab = async (f: Facing) =>
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: f }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })

  const infoOf = (s: MediaStream, f: Facing) => {
    const st = s.getVideoTracks()[0]?.getSettings()
    return { facing: f, label: s.getVideoTracks()[0]?.label, width: st?.width, height: st?.height }
  }

  const start = async () => {
    setError(null)
    try {
      const snd = new PhoneCameraSender(session, {
        onStatus: setStatus,
        onStopped: () => {
          setOn(false)
          if (video.current) video.current.srcObject = null
          setStatus('The computer stopped the camera.')
        },
      })
      sender.current = snd
      await snd.connect()
      const s = await grab(facing) // the permission prompt appears here
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => undefined)
      }
      await snd.send(s, infoOf(s, facing))
      setOn(true)
    } catch (e) {
      sender.current?.stop()
      sender.current = null
      setOn(false)
      const name = e instanceof DOMException ? e.name : ''
      setError(name === 'NotAllowedError' ? 'Camera access was denied. Allow it in the browser settings and try again.' : name === 'NotFoundError' ? 'No camera was found on this device.' : e instanceof Error ? e.message : String(e))
    }
  }

  const stop = () => {
    sender.current?.stop()
    sender.current = null
    if (video.current) video.current.srcObject = null
    setOn(false)
    setStatus('Camera stopped.')
  }

  const flip = async () => {
    const next: Facing = facing === 'user' ? 'environment' : 'user'
    setFacing(next)
    if (!on) return
    try {
      const s = await grab(next)
      if (video.current) video.current.srcObject = s
      await sender.current?.replaceStream(s, infoOf(s, next))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 bg-slate-50 p-4">
      <h1 className="text-lg font-semibold text-slate-900">SmartSpace 3D · phone camera</h1>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
        {on && <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />CAMERA ON · sending to computer</div>}
        {!on && <div className="absolute inset-0 grid place-items-center text-slate-400"><CameraOff size={36} /></div>}
      </div>
      {!secure && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">This page is not on a secure connection, so the browser blocks the camera. Open the https link from the QR code.</p>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {(['environment', 'user'] as Facing[]).map((f) => (
          <button key={f} onClick={() => (on ? void flip() : setFacing(f))} disabled={on && facing === f} className={`rounded-lg border px-3 py-2 font-medium ${facing === f ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}>
            {f === 'environment' ? 'Rear camera' : 'Front camera'}
          </button>
        ))}
      </div>
      {on ? (
        <div className="flex gap-2">
          <button onClick={() => void flip()} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium"><SwitchCamera size={16} />Switch camera</button>
          <button onClick={stop} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white"><CameraOff size={16} />Stop</button>
        </div>
      ) : (
        <button onClick={() => void start()} disabled={!secure} className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50"><Camera size={16} />Start camera</button>
      )}
      <p className="text-center text-xs text-slate-500" role="status">{status}</p>
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
      <p className="text-center text-[11px] text-slate-400">Session {session.slice(0, 4)}… · the camera only runs while you see the red indicator.</p>
    </div>
  )
}
