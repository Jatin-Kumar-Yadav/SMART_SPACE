import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ open, onOpenChange, title, description, children, width = 'max-w-lg' }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  children: ReactNode
  width?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px]" />
        <D.Content className={`fixed left-1/2 top-1/2 z-50 w-[92vw] ${width} -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl focus:outline-none max-h-[90vh] overflow-y-auto`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold text-slate-900">{title}</D.Title>
              {description && <D.Description className="mt-0.5 text-xs text-slate-500">{description}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={16} /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
