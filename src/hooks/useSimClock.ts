import { useEffect } from 'react'
import { simTick } from '@/store/simStore'

/**
 * Drives the environmental simulation from requestAnimationFrame.
 * It used to be ticked by the 3D canvas, which meant the simulation froze whenever the
 * canvas was not mounted (Live Camera / IoT workspaces). The clock now lives here so the
 * three modes keep one continuous simulation.
 */
export function useSimClock() {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      simTick(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}
