import { FastForward, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SPEEDS, simPause, simReset, simResume, simSkip, simStart, simStop, useSim } from '@/store/simStore'
import { formatDuration } from '@/simulation/analytic'

/** Start / pause / resume / stop / reset and speed selection. */
export function SimControls({ compact = false }: { compact?: boolean }) {
  const status = useSim((s) => s.status)
  const speed = useSim((s) => s.speed)
  const setSpeed = useSim((s) => s.setSpeed)
  const time = useSim((s) => s.snapshot?.stats.time ?? 0)
  return (
    <div className={compact ? 'flex shrink-0 items-center gap-1.5 whitespace-nowrap' : 'flex flex-wrap items-center gap-1.5'}>
      {status === 'running' ? (
        <Button variant="default" size="sm" onClick={simPause}><Pause size={13} />Pause</Button>
      ) : status === 'paused' ? (
        <Button variant="default" size="sm" onClick={simResume}><Play size={13} />Resume</Button>
      ) : (
        <Button variant="default" size="sm" onClick={simStart}><Play size={13} />Start</Button>
      )}
      <Tip label="Stop and reset to the initial conditions"><Button size="iconSm" onClick={simStop} disabled={status === 'stopped'} aria-label="Stop"><Square size={12} /></Button></Tip>
      <Tip label="Reset the clock and temperatures"><Button size="iconSm" onClick={simReset} aria-label="Reset"><RotateCcw size={12} /></Button></Tip>
      <div className="ml-1 flex overflow-hidden rounded-md border border-slate-200" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={cn('h-7 px-2 text-[12px] font-medium', speed === s ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>{s}×</button>
        ))}
      </div>
      {!compact && (
        <>
          <Tip label="Fast-forward 10 simulated minutes"><Button size="sm" onClick={() => simSkip(600)}><FastForward size={12} />+10 min</Button></Tip>
          <Tip label="Fast-forward 1 simulated hour"><Button size="sm" onClick={() => simSkip(3600)}><FastForward size={12} />+1 h</Button></Tip>
        </>
      )}
      <span className="ml-1 font-mono text-[12px] tabular-nums text-slate-600">t = {formatDuration(time)}</span>
    </div>
  )
}
