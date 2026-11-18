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
