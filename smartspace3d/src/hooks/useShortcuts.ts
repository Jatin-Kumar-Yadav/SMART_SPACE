import { useEffect } from 'react'
import { useEditor } from '@/store/editorStore'
import { useLayout } from '@/store/layoutStore'
import { rad } from '@/utils/math'
import { saveNow } from './useSpaceLifecycle'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Keyboard shortcuts for the editor. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      const ed = useEditor.getState()
      if (!ed.space) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      // 3D-editing shortcuts must not act on hidden objects while another workspace is open
      if (useLayout.getState().mode !== 'simulation' && !(mod && k === 's')) return
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) ed.redo()
        else ed.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        ed.redo()
      } else if (mod && k === 'd') {
        e.preventDefault()
        ed.duplicateSelected()
      } else if (mod && k === 's') {
        e.preventDefault()
        void saveNow({ thumbnail: true })
      } else if (mod && k === 'a') {
        e.preventDefault()
        ed.select(ed.space.objects.filter((o) => o.visible && !o.locked).map((o) => o.id))
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault()
        ed.removeSelected()
      } else if (k === 'r' && !mod) {
        ed.rotateSelected(e.shiftKey ? -rad(90) : rad(90))
      } else if (k === 'escape') {
        ed.select([])
        ed.selectWall(null)
        ed.setTool('select')
      } else if (k === 'g') {
        ed.set({ showGrid: !ed.showGrid })
      } else if (k === 'f') {
        ed.camera('fit')
      } else if (k.startsWith('arrow')) {
        const step = (e.shiftKey ? 4 : 1) * ed.snapSize
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k] as [number, number]
        if (ed.selection.length) {
          e.preventDefault()
          ed.nudgeSelected(d[0], d[1])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
