import { Copy, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { generateWokwiZip } from '@/iot/wokwi'
import { makeZip } from '@/iot/zip'
import { useIot } from '@/store/iotStore'
import { toast } from '@/store/uiStore'
import { copyText, downloadBlob } from './download'

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
  'DynamicJsonDocument', 'DHTesp', 'DHT', 'BH1750', 'TwoWire', 'HardwareSerial',
  'Servo', 'ESP32PWM'
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
  if (lang === 'ini' || lang === 'toml') {
    const trimmed = line.trimStart()
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) return <span className="text-slate-500">{line}</span>
    if (trimmed.startsWith('[') && trimmed.includes(']')) return <span className="font-semibold text-purple-400">{line}</span>
    if (trimmed.includes('=')) {
      const idx = line.indexOf('=')
      return (
        <>
          <span className="text-sky-300">{line.slice(0, idx)}</span>
          <span className="text-slate-400">=</span>
          <span className="text-amber-200">{line.slice(idx + 1)}</span>
        </>
      )
    }
  }
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
  const [selectedId, setSelectedId] = useState<string>('src/main.cpp')

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
        id: 'src/main.cpp',
        label: 'src/main.cpp · PlatformIO main firmware',
        filename: 'main.cpp',
        text: wk.files['src/main.cpp'] ?? '',
        banner: 'PlatformIO C++ firmware · compiled into .pio/build/esp32dev/firmware.bin for simulation.',
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
        id: 'platformio.ini',
        label: 'platformio.ini · PlatformIO configuration',
        filename: 'platformio.ini',
        text: wk.files['platformio.ini'] ?? '',
        banner: 'PlatformIO configuration defining ESP32 DevKit board, Arduino framework, 115200 baud, and libraries.',
        lang: 'ini',
      })
      opts.push({
        id: 'wokwi.toml',
        label: 'wokwi.toml · Wokwi simulator config',
        filename: 'wokwi.toml',
        text: wk.files['wokwi.toml'] ?? '',
        banner: 'Wokwi for VS Code config linking compiled .pio/build/esp32dev binary & ELF to diagram.json.',
        lang: 'toml',
      })
      opts.push({
        id: 'sketch.ino',
        label: 'sketch.ino · Arduino simulation sketch',
        filename: 'sketch.ino',
        text: wk.files['sketch.ino'] ?? '',
        banner: 'Synchronized Arduino sketch · matches src/main.cpp and diagram.json GPIO pin assignments.',
        lang: 'cpp',
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
        id: 'README.md',
        label: 'README.md · documentation & instructions',
        filename: 'README.md',
        text: wk.files['README.md'] ?? '',
        banner: 'PlatformIO + Wokwi for VS Code step-by-step instructions and interactive serial commands.',
        lang: 'markdown',
      })
      opts.push({
        id: '.gitignore',
        label: '.gitignore · Git ignore rules',
        filename: '.gitignore',
        text: wk.files['.gitignore'] ?? '',
        banner: 'Excludes .pio build directory and VS Code local caches from git tracking.',
        lang: 'text',
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
      const zipData = generateWokwiZip(wk)
      downloadBlob('SMART_SPACE_Wokwi_Project.zip', zipData as BlobPart, 'application/zip')
      toast('PlatformIO + Wokwi project ZIP downloaded. Extract and open SMART_SPACE_Wokwi_Project in VS Code.', 'success')
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
