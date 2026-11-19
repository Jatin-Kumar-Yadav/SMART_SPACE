import React from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT ARTWORK SVG RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

export const Esp32Artwork: React.FC<{ id: string; selected?: boolean }> = ({ selected }) => {
  const leftLabels = ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V']
  const rightLabels = ['GND', '23', '22', 'TX', 'RX', '21', 'GND', '19', '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK']

  return (
    <g className="select-none">
      <defs>
        <linearGradient id="esp32-shield" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="45%" stopColor="#e2e8f0" />
          <stop offset="70%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id="esp32-pcb" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e2229" />
          <stop offset="100%" stopColor="#12151a" />
        </linearGradient>
      </defs>

      {/* Main PCB */}
      <rect x="0" y="0" width="108" height="236" rx="6" fill="url(#esp32-pcb)" stroke={selected ? '#3b82f6' : '#334155'} strokeWidth={selected ? 2.5 : 1.2} />

      {/* PCB Silkscreen border lines */}
      <rect x="10" y="10" width="88" height="216" rx="3" fill="none" stroke="#334155" strokeWidth="0.8" strokeDasharray="4 2" />

      {/* Metal RF Shield */}
      <rect x="18" y="45" width="72" height="105" rx="4" fill="url(#esp32-shield)" stroke="#475569" strokeWidth="1" />
      <text x="54" y="85" fill="#1e293b" fontSize="8.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">ESP32</text>
      <text x="54" y="98" fill="#334155" fontSize="6.5" fontFamily="monospace" textAnchor="middle">WROOM-32</text>
      <path d="M 44 112 Q 54 105 64 112 T 64 122" fill="none" stroke="#475569" strokeWidth="1" />
      <text x="54" y="132" fill="#475569" fontSize="5.5" fontFamily="monospace" textAnchor="middle">CE  FCC  RoHS</text>

      {/* Micro-USB Connector */}
      <rect x="36" y="222" width="36" height="15" rx="2" fill="#94a3b8" stroke="#cbd5e1" strokeWidth="0.8" />
      <rect x="42" y="229" width="24" height="6" rx="1" fill="#1e293b" />

      {/* Tactile Push Buttons */}
      {/* EN Button */}
      <rect x="14" y="206" width="14" height="12" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.7" />
      <circle cx="21" cy="212" r="3.5" fill="#94a3b8" />
      <text x="21" y="224" fill="#94a3b8" fontSize="6" fontFamily="sans-serif" textAnchor="middle">EN</text>

      {/* BOOT Button */}
      <rect x="80" y="206" width="14" height="12" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.7" />
      <circle cx="87" cy="212" r="3.5" fill="#94a3b8" />
      <text x="87" y="224" fill="#94a3b8" fontSize="6" fontFamily="sans-serif" textAnchor="middle">BOOT</text>

      {/* Power LED (Red) & User LED (Blue) */}
      <rect x="22" y="24" width="6" height="5" rx="1" fill="#ef4444" />
      <text x="22" y="21" fill="#ef4444" fontSize="5" fontFamily="monospace">PWR</text>
      <rect x="80" y="24" width="6" height="5" rx="1" fill="#3b82f6" />
      <text x="80" y="21" fill="#3b82f6" fontSize="5" fontFamily="monospace">D2</text>

      {/* Left Header Pins & Labels */}
      {leftLabels.map((lbl, idx) => {
        const py = 24 + idx * 10
        return (
          <g key={`l-${lbl}-${idx}`}>
            <rect x="1" y={py - 3.5} width="6" height="7" rx="1" fill="#e2e8f0" stroke="#475569" strokeWidth="0.6" />
            <circle cx="4" cy={py} r="1.5" fill="#0f172a" />
            <text x="11" y={py + 2.5} fill="#cbd5e1" fontSize="6.2" fontFamily="ui-monospace, monospace" fontWeight="600">{lbl}</text>
          </g>
        )
      })}

      {/* Right Header Pins & Labels */}
      {rightLabels.map((lbl, idx) => {
        const py = 24 + idx * 10
        return (
          <g key={`r-${lbl}-${idx}`}>
            <rect x="101" y={py - 3.5} width="6" height="7" rx="1" fill="#e2e8f0" stroke="#475569" strokeWidth="0.6" />
            <circle cx="104" cy={py} r="1.5" fill="#0f172a" />
            <text x="97" y={py + 2.5} fill="#cbd5e1" fontSize="6.2" fontFamily="ui-monospace, monospace" fontWeight="600" textAnchor="end">{lbl}</text>
          </g>
        )
      })}

      {/* Top Title Silkscreen */}
      <text x="54" y="18" fill="#e2e8f0" fontSize="7" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">ESP32 DevKit</text>
    </g>
  )
}

export const Dht22Artwork: React.FC<{ attrs?: Record<string, string>; selected?: boolean }> = ({ attrs, selected }) => {
  return (
    <g className="select-none">
      {/* White Sensor Enclosure */}
      <rect x="0" y="0" width="44" height="58" rx="4" fill="#f8fafc" stroke={selected ? '#3b82f6' : '#cbd5e1'} strokeWidth={selected ? 2 : 1} filter="drop-shadow(0 2px 4px rgba(0,0,0,0.25))" />
      {/* Mounting hole */}
      <circle cx="22" cy="7" r="2.5" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />
      {/* Slotted Sensor Grid */}
      <rect x="5" y="15" width="34" height="26" rx="2" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="0.6" />
      <line x1="11" y1="18" x2="11" y2="38" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16.5" y1="18" x2="16.5" y2="38" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="22" y1="18" x2="22" y2="38" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="27.5" y1="18" x2="27.5" y2="38" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="33" y1="18" x2="33" y2="38" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7" y1="28" x2="37" y2="28" stroke="#94a3b8" strokeWidth="0.8" />
      {/* Sensor Label */}
      <text x="22" y="49" fill="#1e293b" fontSize="7" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">DHT22</text>
      {attrs?.temperature && <text x="22" y="55" fill="#64748b" fontSize="5" fontFamily="monospace" textAnchor="middle">{attrs.temperature}°C</text>}
      {/* 4 Metal Pins at bottom */}
      <line x1="8" y1="58" x2="8" y2="62" stroke="#94a3b8" strokeWidth="1.6" />
      <line x1="18" y1="58" x2="18" y2="62" stroke="#94a3b8" strokeWidth="1.6" />
      <line x1="28" y1="58" x2="28" y2="62" stroke="#94a3b8" strokeWidth="1.6" />
      <line x1="38" y1="58" x2="38" y2="62" stroke="#94a3b8" strokeWidth="1.6" />
    </g>
  )
}

export const LdrArtwork: React.FC<{ attrs?: Record<string, string>; selected?: boolean }> = ({ selected }) => {
  return (
    <g className="select-none">
      {/* Blue Module PCB */}
      <rect x="0" y="0" width="52" height="70" rx="4" fill="#1e3a8a" stroke={selected ? '#3b82f6' : '#2563eb'} strokeWidth={selected ? 2 : 1} />
      {/* Mounting Hole */}
      <circle cx="10" cy="10" r="3" fill="#0f172a" stroke="#ca8a04" strokeWidth="1" />
      {/* LDR Sensor Component (top-left) */}
      <circle cx="16" cy="35" r="9" fill="#c2410c" stroke="#fed7aa" strokeWidth="1.2" />
      <path d="M 11 32 Q 16 28 21 32 T 21 38" fill="none" stroke="#fef08a" strokeWidth="1" />
      {/* Potentiometer (trimmer) */}
      <rect x="30" y="8" width="16" height="16" rx="2" fill="#0284c7" stroke="#38bdf8" strokeWidth="0.8" />
      <circle cx="38" cy="16" r="5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.8" />
      <line x1="35" y1="16" x2="41" y2="16" stroke="#475569" strokeWidth="1.2" />
      {/* LM393 Comparator IC */}
      <rect x="28" y="32" width="18" height="12" rx="1" fill="#0f172a" stroke="#334155" strokeWidth="0.6" />
      <text x="37" y="40" fill="#94a3b8" fontSize="4.5" fontFamily="monospace" textAnchor="middle">LM393</text>
      {/* Header Pins on right edge */}
      <g>
        <circle cx="52" cy="16" r="2.2" fill="#e2e8f0" stroke="#0f172a" />
        <circle cx="52" cy="28" r="2.2" fill="#e2e8f0" stroke="#0f172a" />
        <circle cx="52" cy="40" r="2.2" fill="#e2e8f0" stroke="#0f172a" />
        <circle cx="52" cy="52" r="2.2" fill="#e2e8f0" stroke="#0f172a" />
      </g>
      {/* Text Label */}
      <text x="26" y="62" fill="#93c5fd" fontSize="6" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">LDR Module</text>
    </g>
  )
}

export const PirArtwork: React.FC<{ selected?: boolean }> = ({ selected }) => {
  return (
    <g className="select-none">
      {/* Blue PCB */}
      <rect x="0" y="0" width="50" height="52" rx="4" fill="#1e3a8a" stroke={selected ? '#3b82f6' : '#2563eb'} strokeWidth={selected ? 2 : 1} />
      {/* Fresnel Dome (White Hemisphere) */}
      <circle cx="25" cy="24" r="17" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
      {/* Lens facets */}
      <circle cx="25" cy="24" r="12" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      <circle cx="25" cy="24" r="6" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      <line x1="8" y1="24" x2="42" y2="24" stroke="#e2e8f0" strokeWidth="0.6" />
      <line x1="25" y1="7" x2="25" y2="41" stroke="#e2e8f0" strokeWidth="0.6" />
      {/* Label */}
      <text x="25" y="47" fill="#93c5fd" fontSize="6" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">PIR Sensor</text>
      {/* Pins at bottom */}
      <line x1="12" y1="52" x2="12" y2="55" stroke="#94a3b8" strokeWidth="1.6" />
      <line x1="25" y1="52" x2="25" y2="55" stroke="#94a3b8" strokeWidth="1.6" />
      <line x1="38" y1="52" x2="38" y2="55" stroke="#94a3b8" strokeWidth="1.6" />
    </g>
  )
}

export const Ds18b20Artwork: React.FC<{ attrs?: Record<string, string>; selected?: boolean }> = ({ attrs, selected }) => {
  return (
    <g className="select-none">
      {/* TO-92 Transistor Package */}
      <path d="M 4 24 C 4 8, 24 8, 24 24 L 24 28 L 4 28 Z" fill="#0f172a" stroke={selected ? '#3b82f6' : '#334155'} strokeWidth="1" />
      <text x="14" y="24" fill="#cbd5e1" fontSize="4.8" fontFamily="monospace" textAnchor="middle">DS18B20</text>
      {attrs?.temperature && <text x="14" y="32" fill="#94a3b8" fontSize="4.5" fontFamily="monospace" textAnchor="middle">{attrs.temperature}°C</text>}
      {/* Leads */}
      <line x1="6" y1="28" x2="6" y2="38" stroke="#94a3b8" strokeWidth="1.4" />
      <line x1="15" y1="28" x2="15" y2="38" stroke="#94a3b8" strokeWidth="1.4" />
      <line x1="24" y1="28" x2="24" y2="38" stroke="#94a3b8" strokeWidth="1.4" />
    </g>
  )
}

export const ResistorArtwork: React.FC<{ attrs?: Record<string, string>; selected?: boolean }> = ({ attrs, selected }) => {
  const is220 = attrs?.value === '220' || !attrs?.value
  const is4700 = attrs?.value === '4700'

  return (
    <g className="select-none">
      {/* Axial Leads */}
      <line x1="0" y1="8" x2="12" y2="8" stroke="#cbd5e1" strokeWidth="1.5" />
      <line x1="38" y1="8" x2="50" y2="8" stroke="#cbd5e1" strokeWidth="1.5" />

      {/* Ceramic Resistor Body */}
      <rect x="11" y="2" width="28" height="12" rx="4" fill="#e2cfb0" stroke={selected ? '#3b82f6' : '#bfa588'} strokeWidth={selected ? 1.5 : 0.8} />

      {/* Color bands */}
      {is220 && (
        <>
          <rect x="15" y="2" width="2.8" height="12" fill="#dc2626" />
          <rect x="20" y="2" width="2.8" height="12" fill="#dc2626" />
          <rect x="25" y="2" width="2.8" height="12" fill="#78350f" />
          <rect x="32" y="2" width="2.8" height="12" fill="#d97706" />
        </>
      )}
      {is4700 && (
        <>
          <rect x="15" y="2" width="2.8" height="12" fill="#eab308" />
          <rect x="20" y="2" width="2.8" height="12" fill="#7c3aed" />
          <rect x="25" y="2" width="2.8" height="12" fill="#dc2626" />
          <rect x="32" y="2" width="2.8" height="12" fill="#d97706" />
        </>
      )}
      {!is220 && !is4700 && (
        <>
          <rect x="15" y="2" width="2.8" height="12" fill="#2563eb" />
          <rect x="20" y="2" width="2.8" height="12" fill="#dc2626" />
          <rect x="25" y="2" width="2.8" height="12" fill="#78350f" />
          <rect x="32" y="2" width="2.8" height="12" fill="#d97706" />
        </>
      )}

      {/* Terminals */}
      <circle cx="0" cy="8" r="1.8" fill="#e2e8f0" stroke="#475569" strokeWidth="0.8" />
      <circle cx="50" cy="8" r="1.8" fill="#e2e8f0" stroke="#475569" strokeWidth="0.8" />
    </g>
  )
}

export const LedArtwork: React.FC<{ attrs?: Record<string, string>; selected?: boolean }> = ({ attrs, selected }) => {
  const color = attrs?.color?.toLowerCase() ?? 'green'
  const label = attrs?.label ?? ''

  const theme = {
    blue: { fill: '#2563eb', stroke: '#60a5fa', glow: 'rgba(59, 130, 246, 0.45)', text: '#38bdf8' },
    green: { fill: '#16a34a', stroke: '#4ade80', glow: 'rgba(34, 197, 94, 0.45)', text: '#4ade80' },
    yellow: { fill: '#ca8a04', stroke: '#fde047', glow: 'rgba(234, 179, 8, 0.45)', text: '#fde047' },
    red: { fill: '#dc2626', stroke: '#f87171', glow: 'rgba(239, 68, 68, 0.45)', text: '#f87171' },
    orange: { fill: '#ea580c', stroke: '#fb923c', glow: 'rgba(249, 115, 22, 0.45)', text: '#fb923c' },
  }[color] ?? { fill: '#16a34a', stroke: '#4ade80', glow: 'rgba(34, 197, 94, 0.45)', text: '#4ade80' }

  return (
    <g className="select-none">
      {/* LED Bulb Dome */}
      <path
        d="M 4 22 C 4 6, 18 6, 18 22 L 20 22 C 20 25, 2 25, 2 22 Z"
        fill={theme.fill}
        stroke={selected ? '#ffffff' : theme.stroke}
        strokeWidth={selected ? 1.8 : 1}
        filter={`drop-shadow(0 0 6px ${theme.glow})`}
      />
      {/* Internal Anode / Cathode Post Highlights */}
      <path d="M 7 21 L 9 14 L 12 14" stroke="#ffffff" strokeWidth="0.9" fill="none" opacity="0.75" />
      <path d="M 14 21 L 14 16" stroke="#ffffff" strokeWidth="0.9" fill="none" opacity="0.6" />

      {/* Leads at bottom */}
      <line x1="7" y1="25" x2="7" y2="32" stroke="#cbd5e1" strokeWidth="1.5" />
      <line x1="15" y1="25" x2="15" y2="32" stroke="#cbd5e1" strokeWidth="1.5" />
      <circle cx="7" cy="32" r="1.6" fill="#f8fafc" stroke="#475569" strokeWidth="0.7" />
      <circle cx="15" cy="32" r="1.6" fill="#f8fafc" stroke="#475569" strokeWidth="0.7" />

      {/* Label under LED */}
      {label && (
        <text x="11" y="44" fill={theme.text} fontSize="7.5" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}

export const ServoArtwork: React.FC<{ attrs?: Record<string, string>; id?: string; selected?: boolean }> = ({ attrs, id, selected }) => {
  const label = attrs?.label ?? id ?? 'Servo'
  const isAc = label.toLowerCase().includes('ac') || id?.toLowerCase().includes('ac')
  const themeColor = isAc ? '#0284c7' : '#16a34a'

  return (
    <g className="select-none">
      {/* Mounting flanges / tabs */}
      <rect x="10" y="8" width="6" height="40" rx="1.5" fill="#1e3a8a" stroke="#172554" strokeWidth="0.8" />
      <rect x="74" y="8" width="6" height="40" rx="1.5" fill="#1e3a8a" stroke="#172554" strokeWidth="0.8" />
      <circle cx="13" cy="14" r="1.5" fill="#0f172a" />
      <circle cx="13" cy="42" r="1.5" fill="#0f172a" />
      <circle cx="77" cy="14" r="1.5" fill="#0f172a" />
      <circle cx="77" cy="42" r="1.5" fill="#0f172a" />

      {/* Main Servo Body (Translucent Blue SG90 Plastic) */}
      <rect
        x="16"
        y="6"
        width="58"
        height="44"
        rx="3"
        fill="#2563eb"
        stroke={selected ? '#ffffff' : '#1d4ed8'}
        strokeWidth={selected ? 2 : 1.2}
      />
      <rect x="18" y="8" width="54" height="40" rx="2" fill="#1d4ed8" opacity="0.6" />

      {/* Gear Cylinder Turret Protrusion */}
      <circle cx="56" cy="28" r="14" fill="#1e40af" stroke="#1d4ed8" strokeWidth="1" />
      <circle cx="56" cy="28" r="10" fill="#3b82f6" />

      {/* Servo Output Shaft / Horn (Single horn arm) */}
      <g transform="rotate(35 56 28)">
        <path
          d="M 52 28 C 52 23.5, 60 23.5, 60 28 L 76 26 C 78 26, 78 30, 76 30 L 60 28 Z"
          fill="#f8fafc"
          stroke="#94a3b8"
          strokeWidth="0.8"
        />
        <circle cx="56" cy="28" r="3.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
        <circle cx="64" cy="27.5" r="0.9" fill="#94a3b8" />
        <circle cx="69" cy="27.8" r="0.9" fill="#94a3b8" />
        <circle cx="74" cy="28" r="0.9" fill="#94a3b8" />
      </g>

      {/* 3-Pin Cable Exit Block */}
      <rect x="0" y="10" width="16" height="36" rx="2" fill="#1e293b" stroke="#334155" strokeWidth="0.8" />

      {/* 3 Wires / Terminals */}
      {/* PWM (Orange) */}
      <line x1="0" y1="16" x2="16" y2="16" stroke="#f97316" strokeWidth="2.5" />
      <circle cx="0" cy="16" r="1.8" fill="#f97316" stroke="#0f172a" strokeWidth="0.8" />
      <text x="7" y="14" fill="#fb923c" fontSize="5" fontWeight="bold" textAnchor="middle">PWM</text>

      {/* V+ (Red) */}
      <line x1="0" y1="28" x2="16" y2="28" stroke="#ef4444" strokeWidth="2.5" />
      <circle cx="0" cy="28" r="1.8" fill="#ef4444" stroke="#0f172a" strokeWidth="0.8" />
      <text x="7" y="26" fill="#f87171" fontSize="5" fontWeight="bold" textAnchor="middle">V+</text>

      {/* GND (Brown) */}
      <line x1="0" y1="40" x2="16" y2="40" stroke="#78350f" strokeWidth="2.5" />
      <circle cx="0" cy="40" r="1.8" fill="#78350f" stroke="#0f172a" strokeWidth="0.8" />
      <text x="7" y="38" fill="#d97706" fontSize="5" fontWeight="bold" textAnchor="middle">GND</text>

      {/* Label Badge on Servo Body */}
      <rect x="22" y="15" width="22" height="26" rx="2" fill="#0f172a" opacity="0.75" />
      <text x="33" y="24" fill={themeColor} fontSize="6" fontWeight="bold" textAnchor="middle">SG90</text>
      <text x="33" y="34" fill="#f8fafc" fontSize="5" fontWeight="bold" textAnchor="middle">{isAc ? 'AC' : 'FAN'}</text>

      {/* Full ID Label below servo */}
      {label && (
        <text x="45" y="54" fill={themeColor} fontSize="7" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}
