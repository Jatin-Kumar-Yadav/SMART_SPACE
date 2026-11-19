import { useEditor } from './editorStore'
import { simSetDevice } from './simStore'
import type { DevicePatch } from '@/simulation/engine'

/**
 * Change a device's operating state on the layout AND on the running engine.
 * (The engine keeps its own live controller state, so layout edits alone would
 * not reach it.)
 */
export function setDevice(id: string, patch: DevicePatch) {
  useEditor.getState().setDeviceState(id, patch)
  simSetDevice(id, patch)
}

/** Open / close a window on the layout and the active scenario (one undo step). */
export const setWindowState = (id: string, open: boolean) => useEditor.getState().setWindowOpen(id, open)

