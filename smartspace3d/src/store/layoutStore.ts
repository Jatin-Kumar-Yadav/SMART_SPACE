import { create } from 'zustand'
import type { ObjectKind } from '@/types'

export type LeftTab = 'furniture' | 'architecture' | 'environment' | 'materials'
export type RightTab = 'properties' | 'space' | 'people' | 'simulate' | 'scenarios'
/** The three connected workspaces. They share one project (the editor store). */
export type AppMode = 'simulation' | 'camera' | 'iot'
export type BottomTab = 'overview' | 'charts' | 'devices' | 'zones' | 'cooling'

interface LayoutState {
  /** which workspace is shown in the centre */
  mode: AppMode
  leftTab: LeftTab
  rightTab: RightTab
  bottomTab: BottomTab
  bottomOpen: boolean
  leftOpen: boolean
  /** the object library can be folded away to give modes 2 / 3 more room */
  libraryOpen: boolean
  rightOpen: boolean
  /** library item currently being dragged over the viewport */
  dragKind: ObjectKind | null
  set: (p: Partial<Omit<LayoutState, 'set'>>) => void
}

export const useLayout = create<LayoutState>((set) => ({
  mode: 'simulation',
  leftTab: 'furniture',
  rightTab: 'properties',
  bottomTab: 'overview',
  bottomOpen: true,
  leftOpen: true,
  libraryOpen: true,
  rightOpen: true,
  dragKind: null,
  set: (p) => set(p),
}))
