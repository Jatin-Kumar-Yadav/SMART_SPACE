import { create } from 'zustand'

export interface FloorHover {
  cell: number
  x: number
  z: number
  /** client coordinates of the pointer, for positioning the tooltip */
  sx: number
  sy: number
}

interface HoverState {
  floor: FloorHover | null
  objectId: string | null
  setFloor: (h: FloorHover | null) => void
  setObject: (id: string | null) => void
}

export const useHover = create<HoverState>((set, get) => ({
  floor: null,
  objectId: null,
  setFloor: (floor) => set({ floor }),
  setObject: (id) => {
    if (get().objectId !== id) set({ objectId: id })
  },
}))
