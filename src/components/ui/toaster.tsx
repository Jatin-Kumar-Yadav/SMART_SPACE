import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useUi } from '@/store/uiStore'

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const TONE = { info: 'text-blue-600', success: 'text-emerald-600', warning: 'text-amber-600', error: 'text-red-600' }

export function Toaster() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const I = ICON[t.kind]
        return (
          <button key={t.id} onClick={() => dismiss(t.id)} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[13px] text-slate-800 shadow-lg">
            <I size={16} className={`mt-0.5 shrink-0 ${TONE[t.kind]}`} />
            <span>{t.text}</span>
          </button>
        )
      })}
    </div>
  )
}
