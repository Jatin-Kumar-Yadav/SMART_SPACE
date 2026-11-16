import type { Scenario, Space } from '@/types'

export const activeScenarioOf = (s: Space): Scenario => s.scenarios.find((x) => x.id === s.activeScenarioId) ?? s.scenarios[0]
