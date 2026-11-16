import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'

export const TooltipProvider = T.Provider

export function Tip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[100] rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
