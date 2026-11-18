import { Copy, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { makeZip } from '@/iot/zip'
import { useIot } from '@/store/iotStore'
import { toast } from '@/store/uiStore'
import { copyText, downloadBlob } from './download'

const WOKWI_FILES = ['sketch.ino', 'diagram.json', 'libraries.txt', 'wokwi.toml', 'README.md'] as const

const CPP_KEYWORDS = new Set([
  'const', 'static', 'extern', 'volatile', 'register',
  'if', 'else', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'for', 'while', 'do', 'goto', 'try', 'catch', 'throw', 'new', 'delete',
  'sizeof', 'typedef', 'struct', 'enum', 'union', 'class', 'public', 'private',
  'protected', 'virtual', 'override', 'inline', 'namespace', 'using'
])

const CPP_TYPES = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'bool',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'size_t', 'String', 'WiFiClient', 'PubSubClient', 'StaticJsonDocument',
  'DynamicJsonDocument', 'DHTesp', 'DHT', 'BH1750', 'TwoWire', 'HardwareSerial'
])

const CPP_CONSTANTS = new Set([
  'true', 'false', 'NULL', 'nullptr', 'HIGH', 'LOW',
  'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN'
])

const PYTHON_KEYWORDS = new Set([
  'import', 'from', 'def', 'class', 'return', 'if', 'else', 'elif',
  'while', 'for', 'in', 'try', 'except', 'finally', 'with', 'as',
  'pass', 'break', 'continue', 'lambda', 'global', 'nonlocal', 'yield',
  'raise', 'assert', 'and', 'or', 'not', 'is'
])

function highlightCppLine(line: string): React.ReactNode {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('//')) {
    return <span className="text-slate-500">{line}</span>
  }
  if (trimmed.startsWith('#include')) {
    const idx = line.indexOf('#include')
    const prefix = line.slice(0, idx)
    const rest = line.slice(idx + 8)
    return (
      <>
        {prefix}
        <span className="font-semibold text-purple-400">#include</span>
        <span className="text-sky-300">{rest}</span>
      </>
    )
  }
  if (trimmed.startsWith('#')) {
    return <span className="font-semibold text-purple-400">{line}</span>
  }

  const regex = /(\/\/.*$)|("(?:\\.|[^"\\])*")|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)|([^\s\w"]+)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index))
    }
    const [full, comment, str, num, word] = match

    if (comment) {
      nodes.push(<span key={match.index} className="text-slate-500">{comment}</span>)
    } else if (str) {
      nodes.push(<span key={match.index} className="text-amber-300">{str}</span>)
    } else if (num) {
      nodes.push(<span key={match.index} className="text-orange-400">{num}</span>)
    } else if (word) {
      if (CPP_KEYWORDS.has(word)) {
        nodes.push(<span key={match.index} className="font-medium text-purple-400">{word}</span>)
      } else if (CPP_TYPES.has(word)) {
        nodes.push(<span key={match.index} className="font-medium text-sky-400">{word}</span>)
      } else if (CPP_CONSTANTS.has(word)) {
        nodes.push(<span key={match.index} className="font-medium text-cyan-300">{word}</span>)
      } else {
        nodes.push(<span key={match.index} className="text-slate-200">{word}</span>)
      }
    } else {
      nodes.push(<span key={match.index} className="text-slate-400">{full}</span>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }
  return nodes
}

function highlightJsonLine(line: string): React.ReactNode {
  const regex = /(\/\/.*$)|("(?:\\.|[^"\\])*")\s*(:)?|(\b\d+(?:\.\d+)?\b)|(\b(?:true|false|null)\b)|([^\s\w"]+)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index))
    }
    const [full, comment, str, colon, num, bool] = match

    if (comment) {
      nodes.push(<span key={match.index} className="text-slate-500">{comment}</span>)
    } else if (str) {
      if (colon) {
        nodes.push(<span key={match.index} className="font-medium text-sky-300">{str}</span>)
        nodes.push(<span key={`${match.index}-colon`} className="text-slate-400">:</span>)
      } else {
        nodes.push(<span key={match.index} className="text-amber-300">{str}</span>)
      }
    } else if (num) {
      nodes.push(<span key={match.index} className="text-orange-400">{num}</span>)
    } else if (bool) {
      nodes.push(<span key={match.index} className="font-medium text-purple-400">{bool}</span>)
    } else {
      nodes.push(<span key={match.index} className="text-slate-400">{full}</span>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }
  return nodes
}

function highlightPythonLine(line: string): React.ReactNode {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) {
    return <span className="text-slate-500">{line}</span>
  }
  const regex = /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)|([^\s\w"']+)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index))
    }
    const [full, comment, str, num, word] = match

    if (comment) {
      nodes.push(<span key={match.index} className="text-slate-500">{comment}</span>)
    } else if (str) {
      nodes.push(<span key={match.index} className="text-amber-300">{str}</span>)
    } else if (num) {
      nodes.push(<span key={match.index} className="text-orange-400">{num}</span>)
    } else if (word) {
      if (PYTHON_KEYWORDS.has(word)) {
        nodes.push(<span key={match.index} className="font-medium text-purple-400">{word}</span>)
      } else if (word === 'True' || word === 'False' || word === 'None') {
        nodes.push(<span key={match.index} className="font-medium text-cyan-300">{word}</span>)
      } else {
        nodes.push(<span key={match.index} className="text-slate-200">{word}</span>)
      }
    } else {
      nodes.push(<span key={match.index} className="text-slate-400">{full}</span>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }
  return nodes
}

function renderCodeLine(line: string, lang: string): React.ReactNode {
  if (lang === 'cpp') return highlightCppLine(line)
  if (lang === 'json') return highlightJsonLine(line)
  if (lang === 'python') return highlightPythonLine(line)
  if (line.trimStart().startsWith('#')) return <span className="text-slate-500">{line}</span>
  return <span className="text-slate-200">{line}</span>
}

interface CodeFileOption {
  id: string
  label: string
  filename: string
  text: string
  banner: string
  lang: string
}

export function CodePanel() {
  const { plan, firmware, wokwi, ctrl, guide } = useIot()
  const [selectedId, setSelectedId] = useState<string>('firmware')

  const fw = firmware.find((f) => f.controllerId === ctrl)
  const wk = ctrl ? wokwi[ctrl] : undefined

  const fileOptions = useMemo<CodeFileOption[]>(() => {
    if (!plan || !ctrl) return []
    const opts: CodeFileOption[] = []

    if (fw) {
      const filename = fw.name.split('/').pop() ?? `${ctrl}.ino`
      opts.push({
        id: 'firmware',
        label: `${filename} · firmware (real hardware)`,
        filename,
        text: fw.code,
        banner: `${fw.language === 'python' ? 'Python 3 script' : 'Arduino sketch'} · boots disarmed, fail-safe on lost heartbeat. Compiled against API stubs only, not run on real hardware.`,
        lang: fw.language === 'python' ? 'python' : 'cpp',
      })
    }

    if (wk?.ok) {
      opts.push({
        id: 'sketch.ino',
        label: 'sketch.ino · Wokwi simulation firmware',
        filename: 'sketch.ino',
        text: wk.files['sketch.ino'] ?? '',
        banner: 'Arduino sketch for Wokwi simulation · matches diagram.json pin assignments and interactive sensors.',
        lang: 'cpp',
      })
      opts.push({
        id: 'diagram.json',
        label: 'diagram.json · Wokwi circuit schematic',
        filename: 'diagram.json',
        text: wk.files['diagram.json'] ?? '',
        banner: 'Wokwi circuit schematic JSON · defining component positions, rotations, and electrical wire routing.',
        lang: 'json',
      })
      opts.push({
        id: 'libraries.txt',
        label: 'libraries.txt · Arduino library dependencies',
        filename: 'libraries.txt',
        text: wk.files['libraries.txt'] ?? '',
        banner: 'Arduino library dependencies required to build and simulate the project in Wokwi.',
        lang: 'text',
      })
      opts.push({
        id: 'wokwi.toml',
        label: 'wokwi.toml · Wokwi simulator config',
        filename: 'wokwi.toml',
        text: wk.files['wokwi.toml'] ?? '',
        banner: 'Wokwi for VS Code configuration file linking diagram.json to sketch.ino.',
        lang: 'toml',
      })
      opts.push({
        id: 'README.md',
        label: 'README.md · documentation & serial commands',
        filename: 'README.md',
        text: wk.files['README.md'] ?? '',
        banner: 'Classroom IoT hardware integration documentation and interactive serial monitor commands.',
        lang: 'markdown',
      })
    }

    if (guide) {
      opts.push({
        id: 'guide',
        label: 'connection-guide.md · physical wiring guide',
        filename: 'connection-guide.md',
        text: guide,
        banner: 'Physical hardware wiring specifications, pin assignments, and voltage safety requirements.',
        lang: 'markdown',
      })
    }

    return opts
  }, [plan, ctrl, fw, wk, guide])

  if (!plan || !ctrl) return <Empty />

  const currentFile = fileOptions.find((f) => f.id === selectedId) ?? fileOptions[0]
  const currentText = currentFile?.text ?? ''
  const currentFilename = currentFile?.filename ?? 'firmware.ino'
  const lines = currentText ? currentText.split('\n') : []

  const copy = async (t: string, what: string) => {
    toast((await copyText(t)) ? `${what} copied` : 'Copy was blocked by the browser. Use Download instead.', 'info')
  }

  const handleDownloadProject = () => {
    if (wk?.ok) {
      const zipFiles: { name: string; data: string | Uint8Array }[] = WOKWI_FILES.map((n) => ({ name: n, data: wk.files[n] }))
      if (guide) zipFiles.push({ name: 'connection-guide.md', data: guide })
      downloadBlob(`wokwi-${ctrl}.zip`, makeZip(zipFiles) as BlobPart, 'application/zip')
      toast('Wokwi project ZIP downloaded. Extract and open folder in VS Code.', 'success')
    } else {
      const files = [...firmware.map((f) => ({ name: f.name, data: f.code }))]
      if (guide) files.push({ name: 'connection-guide.md', data: guide })
      downloadBlob('smartspace-hardware.zip', makeZip(files) as BlobPart, 'application/zip')
      toast('Hardware project ZIP downloaded.', 'success')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* File Dropdown Header */}
      <div className="border-b border-slate-200 p-2.5">
        <select
          value={currentFile?.id ?? 'firmware'}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Select source file"
          className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
        >
          {fileOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2.5 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={!currentText}
          onClick={() => void copy(currentText, currentFilename)}
        >
          <Copy size={13} />Copy
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!currentText}
          onClick={() => downloadBlob(currentFilename, currentText)}
        >
          <Download size={13} />Download Code
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleDownloadProject}
        >
          <Download size={13} />Download Project
        </Button>
      </div>

      {/* Amber Note Banner */}
      {currentFile?.banner && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          {currentFile.banner}
        </div>
      )}

      {/* Dark Syntax Highlighted Code Viewer with Line Numbers */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#070b14] p-3 text-slate-200 select-text ss-scroll">
        {lines.length > 0 ? (
          lines.map((line, i) => (
            <div key={i} className="flex min-w-full hover:bg-slate-900/40">
              <span className="w-8 shrink-0 select-none pr-3 text-right font-mono text-[11px] text-slate-600">
                {i + 1}
              </span>
              <span className="flex-1 whitespace-pre font-mono text-[11.5px] leading-[1.6]">
                {renderCodeLine(line, currentFile.lang) || '\u00A0'}
              </span>
            </div>
          ))
        ) : (
          <div className="grid h-full place-items-center text-xs text-slate-500">— nothing to show —</div>
        )}
      </div>
    </div>
  )
}

export function Empty({ text = 'Press Generate Hardware Setup to create the circuit, pin map, firmware and Wokwi files for this room.' }: { text?: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-[12.5px] text-slate-500">
      <p className="max-w-[260px]">{text}</p>
    </div>
  )
}
