import { Select as S, Slider as Sl, Switch as Sw } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const inputCls =
  'h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-slate-400">{hint}</span>}
    </label>
  )
}

export function TextInput({ value, onCommit, className, ...rest }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; maxLength?: number; autoFocus?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      {...rest}
      className={cn(inputCls, className)}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        e.stopPropagation()
      }}
    />
  )
}

/** Numeric input that commits on blur / Enter and re-syncs when the model changes (e.g. while dragging). */
export function NumberInput({ value, onCommit, step = 0.1, min, max, digits = 2, suffix, disabled, className }: {
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
  max?: number
  digits?: number
  suffix?: string
  disabled?: boolean
  className?: string
}) {
  const fmt = (n: number) => String(Number.isFinite(n) ? +n.toFixed(digits) : 0)
  const [txt, setTxt] = useState(fmt(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setTxt(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focus])
  const commit = () => {
    let n = parseFloat(txt)
    if (!Number.isFinite(n)) n = value
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    setTxt(fmt(n))
    if (n !== value) onCommit(n)
  }
  return (
    <div className={cn('relative', className)}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        disabled={disabled}
        className={cn(inputCls, suffix && 'pr-7')}
        value={txt}
        onFocus={() => setFocus(true)}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          setFocus(false)
          commit()
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{suffix}</span>}
    </div>
  )
}

export function SelectBox<T extends string>({ value, onChange, options, className, disabled }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
  disabled?: boolean
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <S.Trigger className={cn(inputCls, 'flex items-center justify-between gap-1 cursor-pointer', className)}>
        <S.Value />
        <S.Icon><ChevronDown size={14} className="text-slate-400" /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-[200] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-xl">
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator><Check size={13} /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}

export function Slider({ value, onChange, min, max, step = 0.01, onCommit, disabled }: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
}) {
  return (
    <Sl.Root className="relative flex h-5 w-full touch-none items-center select-none" value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={([v]) => onChange(v)} onValueCommit={([v]) => onCommit?.(v)}>
      <Sl.Track className="relative h-1.5 grow rounded-full bg-slate-200">
        <Sl.Range className="absolute h-full rounded-full bg-blue-500" />
      </Sl.Track>
      <Sl.Thumb className="block h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" />
    </Sl.Root>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center gap-2 text-[13px] text-slate-700', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <Sw.Root checked={checked} disabled={disabled} onCheckedChange={onChange} className="relative h-4.5 w-8 shrink-0 rounded-full bg-slate-300 transition-colors data-[state=checked]:bg-blue-600">
        <Sw.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[16px]" />
      </Sw.Root>
      {label}
    </label>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {right}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
