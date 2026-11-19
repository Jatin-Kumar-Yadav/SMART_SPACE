import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { BOARDS } from '@/iot/boards'
import { PARTS } from '@/iot/parts'
import { bomMarkdown } from '@/iot/wiring'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editorStore'
import { generateHardwareSetup, updateHardware, useIot } from '@/store/iotStore'
import { Button } from '@/components/ui/button'
import { Empty } from './CodePanel'
import { downloadBlob } from './download'

export function PinsPanel() {
  const { plan, ctrl } = useIot()
  const cfg = useEditor((s) => s.space?.hardware)
  if (!plan || !cfg) return <Empty />
  const board = BOARDS[plan.family]
  const hasOverrides = Object.keys(cfg.pinOverrides ?? {}).length > 0
  const firstOneWire = plan.parts.find((p) => p.type === 'ds18b20')?.id
  const rows = plan.parts.filter((p) => (!ctrl || p.controllerId === ctrl) && PARTS[p.type].category !== 'expander')

  const setPin = (partId: string, signal: string, pin: string) => {
    updateHardware({ pinOverrides: { ...(cfg.pinOverrides ?? {}), [`${partId}:${signal}`]: pin } })
    generateHardwareSetup()
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasOverrides && (
        <div className="border-b border-slate-200 px-3 py-1.5 text-right">
          <Button size="sm" variant="secondary" onClick={() => { updateHardware({ pinOverrides: {} }); generateHardwareSetup() }}>Reset manual pins</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-slate-100 text-left text-[10.5px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1.5">Virtual device</th><th className="px-2 py-1.5">Hardware</th><th className="px-2 py-1.5">Pin / channel</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const spec = PARTS[p.type]
              const sig = spec.terminals.find((t) => t.kind === 'signal')
              const ch = plan.channels[p.id]
              const row = plan.map.find((m) => m.hardwareDevice.startsWith(`${p.id} `))
              const issue = plan.issues.find((i) => i.severity === 'error' && i.refs.includes(p.id))
              const editable = ch?.kind === 'gpio' && sig && !(p.type === 'ds18b20' && p.id !== firstOneWire)
              return (
                <tr key={p.id} className={cn('border-b border-slate-100', issue && 'bg-red-50')}>
                  <td className="px-2 py-1.5 align-top text-slate-700">{row?.virtualDevice}</td>
                  <td className="px-2 py-1.5 align-top"><span className="font-mono">{p.id}</span><br /><span className="text-slate-500">{spec.label}</span></td>
                  <td className="px-2 py-1.5 align-top">
                    {editable && ch.kind === 'gpio' ? (
                      <select aria-label={`Pin for ${p.id}`} value={ch.pinId} onChange={(e) => setPin(p.id, sig.name, e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11.5px]">
                        {board.pins.filter((x) => !x.reserved || x.id === ch.pinId).map((x) => <option key={x.id} value={x.id}>{x.id}{x.caution ? ' ⚠' : ''}{!x.out ? ' (in only)' : ''}</option>)}
                      </select>
                    ) : <span className="font-mono">{row?.pin ?? '—'}</span>}
                    {row?.note && <div className="mt-0.5 text-slate-500">{row.note}</div>}
                    {issue && <div className="mt-0.5 font-medium text-red-700">{issue.message}</div>}
                    {p.type === 'ds18b20' && p.id !== firstOneWire && <div className="mt-0.5 text-slate-500">shares the 1-Wire pin</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ComponentsPanel() {
  const { plan } = useIot()
  if (!plan) return <Empty />
  const kinds = [...new Set(plan.parts.map((p) => p.type))]
  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bill of materials</h3>
        <Button size="sm" variant="secondary" onClick={() => downloadBlob('bill-of-materials.md', bomMarkdown(plan))}>Download</Button>
      </div>
      <table className="w-full text-[11.5px]">
        <tbody>{plan.bom.map((b, i) => <tr key={i} className="border-b border-slate-100"><td className="w-10 px-3 py-1.5 text-right font-mono text-slate-600">{b.qty}×</td><td className="px-2 py-1.5 text-slate-800">{b.item}{b.note && <span className="text-slate-400"> · {b.note}</span>}</td></tr>)}</tbody>
      </table>
      {plan.supplies.map((s) => <p key={s.controllerId} className="mx-3 my-2 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[11.5px] text-orange-900">Motor supply for {s.controllerId}: {s.volts} V DC, at least {s.minAmps.toFixed(1)} A, common ground with the controller. The motor never connects to a GPIO pin.</p>)}
      <div className="border-t border-slate-200 px-3 py-2">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Part notes</h3>
        {kinds.map((k) => (
          <div key={k} className="mb-2 text-[11.5px]">
            <p className="font-medium text-slate-800">{PARTS[k].label} <span className="font-normal text-slate-400">· {PARTS[k].model}</span></p>
            <ul className="list-disc pl-4 text-slate-600">{PARTS[k].notes.map((n, i) => <li key={i}>{n}</li>)}{PARTS[k].helpers.map((n, i) => <li key={`h${i}`}>needs: {n}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  )
}

const ICON = { error: <XCircle size={14} className="mt-0.5 shrink-0 text-red-600" />, warning: <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />, info: <Info size={14} className="mt-0.5 shrink-0 text-blue-600" /> }

export function ValidationPanel() {
  const { plan } = useIot()
  if (!plan) return <Empty />
  const by = (s: 'error' | 'warning' | 'info') => plan.issues.filter((i) => i.severity === s)
  const errs = by('error')
  return (
    <div className="h-full overflow-auto">
      <div className={cn('flex items-center gap-2 border-b px-3 py-2.5 text-[12.5px] font-medium', errs.length ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800')}>
        {errs.length ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        {errs.length ? `${errs.length} error${errs.length > 1 ? 's' : ''}: do not build this yet` : 'No rule violations found'}
        <span className="ml-auto text-[11px] font-normal">{by('warning').length} warnings · {by('info').length} notes</span>
      </div>
      <p className="border-b border-slate-200 px-3 py-2 text-[11px] text-slate-500">These are rule-based checks (pin capability, duplicates, I²C addresses, voltage levels, current budgets, motor drivers). They do not replace reading the datasheets, and nothing here has been tested on hardware.</p>
      <ul className="divide-y divide-slate-100">
        {(['error', 'warning', 'info'] as const).flatMap((s) => by(s)).map((i, n) => (
          <li key={n} className="flex gap-2 px-3 py-2 text-[12px] text-slate-700">{ICON[i.severity]}<div><p>{i.message}</p>{i.refs.length > 0 && <p className="mt-0.5 font-mono text-[10.5px] text-slate-400">{i.refs.join(' · ')}</p>}</div></li>
        ))}
        {plan.issues.length === 0 && <li className="px-3 py-3 text-[12px] text-slate-500">Nothing to report.</li>}
      </ul>
    </div>
  )
}
