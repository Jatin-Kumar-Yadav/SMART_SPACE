import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { useIot } from '@/store/iotStore'
import { useLive } from '@/store/liveStore'

export function BottomLog() {
  const log = useLive((s) => s.log)
  const link = useLive((s) => s.link)
  const controllers = useLive((s) => s.controllers)
  const plan = useIot((s) => s.plan)
  const mode = useEditor((s) => s.space?.hardware?.runMode ?? 'simulation')
  const [open, setOpen] = useState(true)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'end' }) }, [log.length, open])
  const online = Object.values(controllers).filter((c) => c.online).length
  const armed = Object.values(controllers).filter((c) => c.armed).length
  return (
    <div className="border-t border-slate-200 bg-white" aria-label="Status, serial and telemetry">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11.5px] text-slate-600">
        <span className="font-semibold text-slate-800">Status</span>
        <span>mode <b>{mode === 'simulation' ? 'Simulation Only' : mode === 'monitor' ? 'Hardware Monitor' : 'Hardware Control'}</b></span>
        <span>link <b className={link === 'connected' ? 'text-green-700' : ''}>{link}</b></span>
        <span>controllers online <b>{online}</b>/{plan?.controllers.length ?? 0}</span>
        <span>armed <b className={armed ? 'text-orange-700' : ''}>{armed}</b></span>
        <div className="ml-auto flex gap-1">
          <Button size="iconSm" variant="ghost" aria-label="Clear log" onClick={() => useLive.setState({ log: [] })}><Trash2 size={12} /></Button>
          <Button size="iconSm" variant="ghost" aria-label={open ? 'Collapse log' : 'Expand log'} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</Button>
        </div>
      </div>
      {open && (
        <div className="h-28 overflow-auto bg-slate-950 px-3 py-1.5 font-mono text-[11px] leading-[1.45]" role="log">
          {log.length === 0 && <p className="text-slate-500">No serial / telemetry traffic yet. Messages appear here once a controller is connected.</p>}
          {log.map((l, i) => (
            <p key={i} className={cn(l.dir === 'in' ? 'text-emerald-300' : l.dir === 'out' ? 'text-sky-300' : 'text-amber-300')}>
              <span className="text-slate-500">{new Date(l.ts).toLocaleTimeString()} </span>{l.dir === 'in' ? '← ' : l.dir === 'out' ? '→ ' : '· '}{l.text}
            </p>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  )
}
