import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useEditor } from './store/editorStore'
import { useSim } from './store/simStore'

// handy for debugging & automated acceptance tests
;(window as unknown as Record<string, unknown>).__smartspace = { editor: useEditor, sim: useSim }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
