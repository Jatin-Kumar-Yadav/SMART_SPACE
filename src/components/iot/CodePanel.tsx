import { Copy, Download, ExternalLink, FileCode2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { makeZip } from '@/iot/zip'
import { useIot } from '@/store/iotStore'
import { toast } from '@/store/uiStore'
import { copyText, downloadBlob } from './download'

type Source = 'firmware' | 'wokwi'
const WOKWI_FILES = ['sketch.ino', 'diagram.json', 'libraries.txt', 'wokwi.toml', 'README.md'] as const

export function CodePanel() {
  const { plan, firmware, wokwi, ctrl, guide } = useIot()
  const [src, setSrc] = useState<Source>('firmware')
  const [wfile, setWfile] = useState<(typeof WOKWI_FILES)[number]>('sketch.ino')
  if (!plan || !ctrl) return <Empty />
  const fw = firmware.find((f) => f.controllerId === ctrl)
  const wk = wokwi[ctrl]

  const text = src === 'firmware' ? (fw?.code ?? '') : wk?.ok ? wk.files[wfile] : ''
  const fileName = src === 'firmware' ? (fw?.name.split('/').pop() ?? 'firmware.txt') : wfile
  const copy = async (t: string, what: string) => toast((await copyText(t)) ? `${what} copied` : 'Copy was blocked by the browser. Use Download instead.', 'info')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2">
        {(['firmware', 'wokwi'] as const).map((s) => (
          <button key={s} onClick={() => setSrc(s)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', src === s ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{s === 'firmware' ? 'Hardware firmware' : 'Wokwi simulation'}</button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">{ctrl}</span>
      </div>

      {src === 'firmware' && fw && (
        <div className="space-y-1 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600">
          <p className="font-medium text-slate-700">{fw.language === 'python' ? 'Python 3 script' : 'Arduino sketch'} · protocol v1 · boots disarmed, fail-safe on lost heartbeat</p>
          <ol className="list-decimal space-y-0.5 pl-4">{fw.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="text-amber-700">Generated code. It has been compiled against API stubs and syntax-checked, but not run on real hardware.</p>
        </div>
      )}

      {src === 'wokwi' && (
        <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600">
          {!wk && <p>No export for this controller.</p>}
          {wk && !wk.ok && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900"><b>Cannot export to Wokwi.</b> {wk.reason}</p>}
          {wk?.ok && (
            <>
              {wk.substitutions.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  <p className="font-medium">Simulation copy: these parts are replaced in Wokwi only</p>
                  <ul className="mt-0.5 list-disc pl-4">{wk.substitutions.map((s) => <li key={s.partId}><b>{s.partId}</b>: {s.reason}</li>)}</ul>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => { window.open(wk.openUrl, '_blank', 'noopener'); toast('Wokwi opened. Paste diagram.json and sketch.ino into the new project (use the Copy buttons here).', 'info') }}><ExternalLink size={12} />Open in Wokwi</Button>
                <Button size="sm" variant="secondary" onClick={() => downloadBlob(`wokwi-${ctrl}.zip`, makeZip(WOKWI_FILES.map((n) => ({ name: n, data: wk.files[n] }))) as BlobPart, 'application/zip')}><Download size={12} />Download all (.zip)</Button>
              </div>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Click <b>Open in Wokwi</b>{wk.openUrlVerified ? '' : ' (this board\'s start URL is unverified; use New project → Arduino Uno if it does not load)'}.</li>
                <li>Replace <b>sketch.ino</b> and <b>diagram.json</b> there with the files below (Copy), and add <b>libraries.txt</b> in the Library Manager.</li>
                <li>Wokwi has no documented import link, so SmartSpace cannot load the project for you.</li>
              </ol>
              <details><summary className="cursor-pointer text-slate-500">Warnings ({wk.warnings.length})</summary><ul className="mt-1 list-disc pl-4">{wk.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
              <div className="flex gap-1">{WOKWI_FILES.map((n) => <button key={n} onClick={() => setWfile(n)} className={cn('rounded px-2 py-0.5 text-[11px]', wfile === n ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100')}>{n}</button>)}</div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-1.5">
        <FileCode2 size={13} className="text-slate-400" />
        <span className="font-mono text-[11.5px] text-slate-700">{fileName}</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="secondary" disabled={!text} onClick={() => void copy(text, fileName)}><Copy size={12} />Copy</Button>
          <Button size="sm" variant="secondary" disabled={!text} onClick={() => downloadBlob(fileName, text)}><Download size={12} />Download</Button>
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto bg-slate-950 p-3 font-mono text-[11px] leading-[1.5] text-slate-200" tabIndex={0} aria-label="Generated code">{text || '— nothing to show —'}</pre>
      <div className="flex gap-1.5 border-t border-slate-200 px-3 py-1.5">
        <Button size="sm" variant="secondary" onClick={() => downloadBlob('connection-guide.md', guide)}><Download size={12} />Connection guide</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadBlob('smartspace-hardware.zip', makeZip([...firmware.map((f) => ({ name: f.name, data: f.code })), { name: 'connection-guide.md', data: guide }]) as BlobPart, 'application/zip')}><Download size={12} />All firmware + guide (.zip)</Button>
      </div>
    </div>
  )
}

export function Empty({ text = 'Press Generate Hardware Setup to create the circuit, pin map, firmware and Wokwi files for this room.' }: { text?: string }) {
  return <div className="grid h-full place-items-center p-6 text-center text-[12.5px] text-slate-500"><p className="max-w-[260px]">{text}</p></div>
}
