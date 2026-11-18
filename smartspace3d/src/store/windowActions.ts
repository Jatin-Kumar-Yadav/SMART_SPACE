import { useEditor } from './editorStore'

/** Open / close a window on the layout and the active scenario (one undo step). */
export const setWindowState = (id: string, open: boolean) => useEditor.getState().setWindowOpen(id, open)
