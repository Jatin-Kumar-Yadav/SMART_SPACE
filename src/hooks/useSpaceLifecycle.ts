import { useEffect } from 'react'
import { getRepository } from '@/database/repository'
import { useEditor } from '@/store/editorStore'
import { simInit, simSync } from '@/store/simStore'
import { toast } from '@/store/uiStore'
import { renderSpaceThumbnail } from '@/three/thumbnails'

const SAVE_DEBOUNCE_MS = 800
const THUMB_EVERY_MS = 30_000

let lastThumb: { id: string; url?: string; at: number } = { id: '', at: 0 }

/** Persist the open space now (optionally refreshing its dashboard thumbnail). */
export async function saveNow(opts: { thumbnail?: boolean } = {}) {
  const st = useEditor.getState()
  const space = st.space
  if (!space) return
  const rev = st.revision
  st.setSaveStatus('saving')
  try {
    if (lastThumb.id !== space.id) lastThumb = { id: space.id, url: space.thumbnail, at: 0 }
    if (opts.thumbnail || (!lastThumb.url && Date.now() - lastThumb.at > 4000) || Date.now() - lastThumb.at > THUMB_EVERY_MS) {
      try {
        lastThumb = { id: space.id, url: renderSpaceThumbnail(space), at: Date.now() }
      } catch (e) {
        console.warn('thumbnail failed', e)
      }
    }
    await getRepository().save({ ...space, thumbnail: lastThumb.url })
    if (useEditor.getState().revision === rev) useEditor.getState().setSaveStatus('saved')
    else useEditor.getState().setSaveStatus('unsaved')
  } catch (e) {
    console.error(e)
    useEditor.getState().setSaveStatus('unsaved')
    toast('Could not save the space to the browser database', 'error')
  }
}

/** Debounced autosave + simulation resync whenever the layout or scenario changes. */
export function useAutosaveAndSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    simInit()
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.space) return
      if (s.space.id !== prev.space?.id) {
        simInit(true)
        return
      }
      if (s.revision === prev.revision) return
      simSync()
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS)
    })
    // first thumbnail shortly after opening
    const first = setTimeout(() => void saveNow({ thumbnail: true }), 2500)
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      clearTimeout(first)
    }
  }, [])
}

/** Warn before closing the tab while edits are still unsaved. */
export function useBeforeUnload() {
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().saveStatus !== 'saved') {
        e.preventDefault()
        void saveNow()
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])
}
