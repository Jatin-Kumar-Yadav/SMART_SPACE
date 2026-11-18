import type { FirmwareFile } from './firmware'
import type { HardwareManifest } from './manifest'
import type { HardwarePlan } from './types'
import type { WokwiResult } from './wokwi'

export interface ProjectFile { name: string; data: string }

/**
 * Wokwi-compatible project folder:
 *   manifest.json, README.md, connection-guide.md
 *   hardware/<controller>/{sketch.ino, diagram.json, libraries.txt, wokwi.toml}   ← one Wokwi project per controller (simulation copy)
 *   hardware/<controller>/firmware/<file>                                           ← the real-hardware firmware
 */
export function buildProject(plan: HardwarePlan, manifest: HardwareManifest, firmware: FirmwareFile[], wokwi: Record<string, WokwiResult>, guide: string): ProjectFile[] {
  const files: ProjectFile[] = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'connection-guide.md', data: guide },
    { name: 'README.md', data: readme(plan, manifest, wokwi) },
  ]
  for (const c of plan.controllers) {
    const fw = firmware.find((f) => f.controllerId === c.id)
    if (fw) files.push({ name: `hardware/${c.id}/firmware/${fw.name.split('/').pop()}`, data: fw.code })
    const w = wokwi[c.id]
    if (w?.ok) {
      for (const [n, data] of Object.entries(w.files)) if (n !== 'README.md') files.push({ name: `hardware/${c.id}/${n}`, data })
      files.push({ name: `hardware/${c.id}/WOKWI-README.md`, data: w.files['README.md'] })
    } else {
      files.push({ name: `hardware/${c.id}/NO-WOKWI.txt`, data: `This controller cannot be exported to Wokwi: ${w && !w.ok ? w.reason : 'no export'}\nUse the firmware in ./firmware on real hardware.\n` })
    }
  }
  return files
}

function readme(plan: HardwarePlan, m: HardwareManifest, wokwi: Record<string, WokwiResult>): string {
  const rows = m.controllers.map((c) => `- **${c.id}** (${c.role}) · ${c.devices.length} devices · ${wokwi[c.id]?.ok ? 'Wokwi project in hardware/' + c.id : 'no Wokwi export'}`)
  return `# SmartSpace 3D hardware project

Room: ${m.roomId}

${plan.controllers.length} controller(s):
${rows.join('\n')}

## Communication
${m.comms.transport}, topic root \`${m.comms.topicRoot}\`. ${m.comms.note}

## Wokwi
Each hardware/<controller> folder is a Wokwi project (sketch.ino, diagram.json, libraries.txt, wokwi.toml). Wokwi has no documented import link: open a new project on wokwi.com and paste the files. Wokwi cannot simulate every part (DC motors, BME280, BH1750 are replaced by LED / DHT22 / LDR there; see each sketch's banner).
Several controllers cannot talk to each other inside one Wokwi project: simulate one controller per project.

manifest.json is the single source of truth: the diagram, the firmware pin tables and the app's circuit view are all generated from it.
`
}
