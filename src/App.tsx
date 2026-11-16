import { Suspense, lazy } from 'react'
import { Dashboard } from '@/components/layout/Dashboard'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useHashRoute } from '@/hooks/useHashRoute'

// The editor pulls in three.js / R3F (~1.5 MB); load it only when a space is opened.
const PhonePage = lazy(() => import('@/components/camera/PhonePage').then((m) => ({ default: m.PhonePage })))
const EditorPage = lazy(() => import('@/components/layout/EditorPage').then((m) => ({ default: m.EditorPage })))

export default function App() {
  const route = useHashRoute()
  return (
    <TooltipProvider>
      {route.kind === 'phone' ? (
        <Suspense fallback={null}>
          <PhonePage session={route.session} />
        </Suspense>
      ) : route.kind === 'dashboard' ? (
        <Dashboard />
      ) : (
        <Suspense fallback={<div className="grid h-screen place-items-center text-sm text-slate-500">Loading 3D editor…</div>}>
          <EditorPage key={route.id} id={route.id} />
        </Suspense>
      )}
      <Toaster />
    </TooltipProvider>
  )
}
