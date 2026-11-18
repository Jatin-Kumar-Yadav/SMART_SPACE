export type Lang = 'cpp' | 'python' | 'json' | 'text'
export interface Tok { t: 'kw' | 'type' | 'str' | 'num' | 'com' | 'pre' | 'fn' | 'plain'; s: string }

const KW = {
  cpp: new Set('if else for while do switch case break continue return const static volatile constexpr void new delete class struct enum namespace using typedef true false nullptr auto inline extern'.split(' ')),
  python: new Set('import from as def class return if elif else for while in not and or is None True False try except finally with pass break continue lambda global yield raise'.split(' ')),
  json: new Set(['true', 'false', 'null']),
  text: new Set<string>(),
}
const TYPES = new Set('int long short char float double bool boolean byte String uint8_t uint16_t uint32_t int8_t int16_t int32_t size_t unsigned signed WiFiClient PubSubClient JsonDocument DHT BH1750 OneWire DallasTemperature'.split(' '))

const RULES: Record<Exclude<Lang, 'text'>, RegExp> = {
  cpp: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#\s*\w+)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?f?\b)|([A-Za-z_]\w*)/g,
  python: /(#[^\n]*)|("""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|()(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g,
  json: /()("(?:\\.|[^"\\])*")|()(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)/g,
}

/** Tiny tokenizer (no dependency): good enough to colour the generated Arduino / Python / JSON. Splits into lines. */
export function highlight(code: string, lang: Lang): Tok[][] {
  const lines: Tok[][] = [[]]
  const push = (t: Tok['t'], s: string) => {
    const parts = s.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) lines.push([])
      if (p) lines[lines.length - 1].push({ t, s: p })
    })
  }
  if (lang === 'text') { push('plain', code); return lines }
  const re = new RegExp(RULES[lang].source, 'g')
  let last = 0
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) push('plain', code.slice(last, m.index))
    const [txt, com, str, pre, num, id] = m
    if (com) push('com', txt)
    else if (str) push('str', txt)
    else if (pre) push('pre', txt)
    else if (num) push('num', txt)
    else if (id) {
      const after = code[m.index + txt.length]
      push(KW[lang].has(id) ? 'kw' : TYPES.has(id) ? 'type' : after === '(' ? 'fn' : 'plain', id)
    } else push('plain', txt)
    last = m.index + txt.length
    if (txt.length === 0) re.lastIndex++
  }
  if (last < code.length) push('plain', code.slice(last))
  return lines
}

export const langOf = (file: string): Lang => (/\.(ino|cpp|h|c)$/.test(file) ? 'cpp' : /\.py$/.test(file) ? 'python' : /\.json$/.test(file) ? 'json' : 'text')
