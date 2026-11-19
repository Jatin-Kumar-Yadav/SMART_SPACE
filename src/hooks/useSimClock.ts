import { useEffect } from 'react'
import { startSimulationLoop, stopSimulationLoop, useSim } from '@/store/simStore'

/**
 * Ensures the simulation loop lifecycle is synced with the workspace.
 * The loop implementation itself is managed as a singleton in simStore
 * to prevent duplicate timers and restarts across component re-renders.
 */
export function useSimClock() {
  const status = useSim((s) => s.status)

  useEffect(() => {
    if (status === 'running') {
      startSimulationLoop()
    }
  }, [status])

  useEffect(() => {
    return () => {
      stopSimulationLoop()
    }
  }, [])
}
