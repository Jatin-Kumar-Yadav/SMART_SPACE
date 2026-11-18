import { Copy, Download, ExternalLink, FolderDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectBox } from '@/components/ui/controls'
import { highlight, langOf, type Tok } from '@/iot/highlight'
import { PARTS } from '@/iot/parts'
import { buildProject } from '@/iot/project'
import { makeZip } from '@/iot/zip'
import { useIot } from '@/store/iotStore'
import { toast } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { copyText, downloadBlob } from './download'

const TOK: Record<Tok['t'], string> = { kw: 'text-pink-400', type: 'text-sky-300', str: 'text-amber-300', num: 'text-orange-300', com: 'text-slate-500 italic', pre: 'text-violet-300', fn: 'text-emerald-300', plain: 'text-slate-200' }

/** Read-only code viewer with line numbers and syntax colours. */
export function CodeView({ text, file }: { text: string; file: string }) {
  const lines = useMemo(() => highlight(text, langOf(file)), [text, file])
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-950 py-2 font-mono text-[11px] leading-[1.55]" tabIndex={0} aria-label="Generated code" data-testid="code-view">
      <table className="min-w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="w-10 select-none px-2 text-right align-top text-slate-600">{i + 1}</td>
              <td className="whitespace-pre pr-3">{l.length ? l.map((t, j) => <span key={j} className={TOK[t.t]}>{t.s}</span>) : ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CodePanel() {
  const { plan, firmware, wokwi, ctrl, guide, manifest } = useIot()
  const [file, setFile] = useState('firmware')
  const fw = firmware.find((f) => f.controllerId === ctrl)
  const wk = ctrl ? wokwi[ctrl] : undefined
  const entries = useMemo(() => {
    const e: { key: string; label: string; name: string; text: string }[] = []
    if (fw) e.push({ key: 'firmware', label: `${fw.name.split('/').pop()} · firmware (real hardware)`, name: fw.name.split('/').pop()!, text: fw.code })
    if (wk?.ok) for (const n of ['sketch.ino', 'diagram.json', 'libraries.txt', 'wokwi.toml'] as const) e.push({ key: `w:${n}`, label: `${n} · Wokwi`, name: n, text: wk.files[n] })
    if (manifest) e.push({ key: 'manifest', label: 'manifest.json · hardware manifest', name: 'manifest.json', text: JSON.stringify({ ...manifest, controllers: manifest.controllers.filter((c) => c.id === ctrl) }, null, 2) })
    return e
  }, [fw, wk, manifest, ctrl])
  useEffect(() => { if (!entries.some((e) => e.key === file)) setFile(entries[0]?.key ?? 'firmware') }, [entries, file])
  if (!plan || !ctrl) return <Empty />
  const cur = entries.find((e) => e.key === file) ?? entries[0]
  const text = cur?.text ?? ''
  const copy = async () => toast((await copyText(text)) ? `${cur?.name} copied` : 'Copy was blocked by the browser. Use Download Code instead.', 'info')
  const project = () => {
    if (!manifest) return
    downloadBlob('smartspace-hardware-project.zip', makeZip(buildProject(plan, manifest, firmware, wokwi, guide)) as BlobPart, 'application/zip')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2">
        <SelectBox className="min-w-0 flex-1" value={cur?.key ?? ''} onChange={setFile} options={entries.map((e) => ({ value: e.key, label: e.label }))} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-1.5">
        <Button size="sm" variant="secondary" disabled={!text} onClick={() => void copy()}><Copy size={12} />Copy</Button>
        <Button size="sm" variant="secondary" disabled={!text} onClick={() => cur && downloadBlob(cur.name, text)}><Download size={12} />Download Code</Button>
        <Button size="sm" onClick={project} disabled={!manifest}><FolderDown size={12} />Download Project</Button>
      </div>
      {fw && file === 'firmware' && (
        <p className="border-b border-slate-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">{fw.language === 'python' ? 'Python 3 script' : 'Arduino sketch'} · boots disarmed, fail-safe on lost heartbeat. Compiled against API stubs only, not run on real hardware.</p>
      )}
      {file.startsWith('w:') && wk?.ok && (
        <div className="space-y-1 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
          {wk.substitutions.length > 0 && <p className="text-amber-800">Wokwi simulation copy: {wk.substitutions.map((s) => `${s.partId} (${s.reason.split('.')[0]})`).join('; ')}.</p>}
          <button className="inline-flex items-center gap-1 text-blue-700 underline" onClick={() => { window.open(wk.openUrl, '_blank', 'noopener'); toast('Wokwi cannot import a link. Paste diagram.json and sketch.ino into the new project.', 'info') }}><ExternalLink size={11} />Open Wokwi (new project; paste the files)</button>
        </div>
      )}
      {!wk?.ok && wk && file === 'firmware' && <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">No Wokwi export: {wk.reason}</p>}
      <CodeView text={text || '— nothing to show —'} file={cur?.name ?? ''} />
    </div>
  )
}

export function LibrariesPanel() {
  const { plan, firmware, ctrl } = useIot()
  const fw = firmware.find((f) => f.controllerId === ctrl)
  if (!plan || !ctrl) return <Empty />
  const used = [...new Set(plan.parts.filter((p) => p.controllerId === ctrl).map((p) => p.type))]
  const python = fw?.language === 'python'
  const rows = (fw?.libraries ?? []).map((lib) => ({ lib, parts: used.filter((t) => (python ? PARTS[t].libraries.python : PARTS[t].libraries.arduino).includes(lib)).map((t) => PARTS[t].label) }))
  return (
    <div className="h-full overflow-auto p-3 text-[12px] text-slate-700">
      <p className="mb-2 text-slate-500">{python ? 'Install with pip' : 'Install with Arduino IDE → Library Manager (or the same names in libraries.txt for Wokwi / PlatformIO)'}:</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.lib} className={cn('rounded-lg border border-slate-200 bg-white px-2.5 py-1.5')}>
            <p className="font-mono text-[11.5px] font-semibold text-slate-800">{r.lib}</p>
            <p className="text-[11px] text-slate-500">{r.parts.length ? `for ${r.parts.join(', ')}` : 'networking / protocol (MQTT, JSON, Wi-Fi)'}</p>
          </li>
        ))}
        {rows.length === 0 && <li className="text-slate-500">No extra libraries.</li>}
      </ul>
    </div>
  )
}

export function Empty({ text = 'Press Generate Hardware Setup to create the circuit, pin map, firmware and Wokwi files for this room.' }: { text?: string }) {
  return <div className="grid h-full place-items-center p-6 text-center text-[12.5px] text-slate-500"><p className="max-w-[260px]">{text}</p></div>
}
