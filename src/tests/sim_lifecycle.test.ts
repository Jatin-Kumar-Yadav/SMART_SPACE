import { describe, expect, it, beforeEach } from 'vitest'
import { createSeminarHall } from '@/demo/seminarHall'
import { useEditor } from '@/store/editorStore'
import {
  useSim,
  simInit,
  simStart,
  simPause,
  simResume,
  simReset,
  simTick,
  getEngine,
  stopSimulationLoop,
} from '@/store/simStore'

describe('Classroom Simulation Lifecycle (8 Verification Cases)', () => {
  beforeEach(() => {
    stopSimulationLoop()
    const space = createSeminarHall()
    useEditor.getState().openSpace(space)
    simInit(true)
  })

  it('Case 1: Click Run once: simulation starts exactly once', () => {
    expect(useSim.getState().status).toBe('stopped')
    simStart()
    expect(useSim.getState().status).toBe('running')
    const eng = getEngine()
    expect(eng).not.toBeNull()
  })

  it('Case 2: Click Run repeatedly: no duplicate loops or resets', () => {
    simStart()
    const eng = getEngine()!
    // Advance simulation slightly
    simTick(0.5) // simulated seconds advance
    const timeAfterAdvance = eng.time
    const tempAfterAdvance = eng.snapshot().stats.avgT
    expect(timeAfterAdvance).toBeGreaterThan(0)

    // Repeated clicks to Run
    simStart()
    simStart()
    simStart()

    // Assert that repeated clicks DID NOT reset time or temperature
    expect(eng.time).toBe(timeAfterAdvance)
    expect(eng.snapshot().stats.avgT).toBe(tempAfterAdvance)
    expect(useSim.getState().status).toBe('running')
  })

  it('Case 3: Allow the simulation to run: temperature changes continuously', () => {
    simStart()
    const eng = getEngine()!
    const t0 = eng.snapshot().stats.avgT

    // Tick over simulated time
    for (let i = 0; i < 20; i++) {
      simTick(0.1)
    }

    const t1 = eng.snapshot().stats.avgT
    expect(eng.time).toBeGreaterThan(0)
    expect(t1).toBeLessThan(t0) // ACs engage and cooling begins
  })

  it('Case 4: Pause: all values remain unchanged', () => {
    simStart()
    for (let i = 0; i < 10; i++) simTick(0.1)

    const eng = getEngine()!
    const timeBeforePause = eng.time
    const tempBeforePause = eng.snapshot().stats.avgT

    simPause()
    expect(useSim.getState().status).toBe('paused')

    // Ticking while paused should do nothing
    simTick(0.1)
    expect(eng.time).toBe(timeBeforePause)
    expect(eng.snapshot().stats.avgT).toBe(tempBeforePause)
  })

  it('Case 5: Resume: simulation continues from the previous values', () => {
    simStart()
    for (let i = 0; i < 10; i++) simTick(0.1)

    const eng = getEngine()!
    const timeBeforePause = eng.time
    const tempBeforePause = eng.snapshot().stats.avgT

    simPause()
    expect(useSim.getState().status).toBe('paused')

    simResume()
    expect(useSim.getState().status).toBe('running')
    // Must not have reinitialized to 0
    expect(eng.time).toBe(timeBeforePause)
    expect(eng.snapshot().stats.avgT).toBe(tempBeforePause)

    // Further ticks advance from here
    simTick(0.1)
    expect(eng.time).toBeGreaterThan(timeBeforePause)
  })

  it('Case 6: Reset: values return to initial conditions', () => {
    simStart()
    for (let i = 0; i < 15; i++) simTick(0.1)

    const eng = getEngine()!
    expect(eng.time).toBeGreaterThan(0)

    simReset()
    expect(eng.time).toBe(0)
    expect(eng.snapshot().stats.avgT).toBeCloseTo(32, 1) // Initial temp restored
  })

  it('Case 7: Change a scenario parameter while running: simulation does not unexpectedly restart', () => {
    simStart()
    for (let i = 0; i < 10; i++) simTick(0.1)

    const eng = getEngine()!
    const timeBeforeEdit = eng.time
    const tempBeforeEdit = eng.snapshot().stats.avgT
    expect(timeBeforeEdit).toBeGreaterThan(0)

    // User updates scenario while running (e.g. target temperature, tolerance, or outside temp)
    const space = useEditor.getState().space!
    const sc = space.scenarios[0]
    const modifiedScenario = { ...sc, targetTempC: 22, outsideTempC: 38 }

    eng.rebuild(space, modifiedScenario)

    // Must NOT have called reset: time and current temperature distribution are preserved
    expect(eng.time).toBe(timeBeforeEdit)
    expect(eng.snapshot().stats.avgT).toBe(tempBeforeEdit)
    expect(eng.scenario.targetTempC).toBe(22)
    expect(eng.scenario.outsideTempC).toBe(38)

    // Continuing simulation proceeds from the preserved state
    simTick(0.1)
    expect(eng.time).toBeGreaterThan(timeBeforeEdit)
  })

  it('Case 8: Navigate between tabs or re-render components: simulation does not restart unexpectedly', () => {
    simStart()
    for (let i = 0; i < 10; i++) simTick(0.1)

    const eng = getEngine()!
    const timeBeforeRemount = eng.time
    const tempBeforeRemount = eng.snapshot().stats.avgT
    expect(timeBeforeRemount).toBeGreaterThan(0)

    // Component remount invoking simInit(false) for the same space
    simInit(false)

    // Must not restart or wipe running simulation
    expect(useSim.getState().status).toBe('running')
    expect(eng.time).toBe(timeBeforeRemount)
    expect(eng.snapshot().stats.avgT).toBe(tempBeforeRemount)
  })
})
