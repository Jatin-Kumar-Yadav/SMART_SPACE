import { memo, type ReactElement } from 'react'
import * as THREE from 'three'
import type { ObjectKind, Vec3 } from '@/types'

/**
 * Procedurally built 3D models. Every model is authored in the object's local
 * frame: origin at the centre of its footprint on the floor, +z = front, and is
 * sized from `dims` = [width, height, depth] so resizing an object rescales
 * the geometry sensibly.
 */

export interface ModelProps {
  dims: Vec3
  color: string
  /** 0…1 emissive intensity for lights / glow */
  glow?: number
  /** 0…1 fan spin phase handled by parent; kept for API symmetry */
  open?: boolean
}

type P3 = [number, number, number]

function Box({ p, s, c, r = 0.6, m = 0, rot, cast = true, opacity }: { p: P3; s: P3; c: string; r?: number; m?: number; rot?: P3; cast?: boolean; opacity?: number }) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={r} metalness={m} transparent={opacity !== undefined} opacity={opacity ?? 1} />
    </mesh>
  )
}

function Cyl({ p, rt, rb, h, c, r = 0.6, m = 0, seg = 20, rot, cast = true }: { p: P3; rt: number; rb?: number; h: number; c: string; r?: number; m?: number; seg?: number; rot?: P3; cast?: boolean }) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <cylinderGeometry args={[rt, rb ?? rt, h, seg]} />
      <meshStandardMaterial color={c} roughness={r} metalness={m} />
    </mesh>
  )
}

function Sphere({ p, r: rad, c, rough = 0.7, sy = 1, cast = true }: { p: P3; r: number; c: string; rough?: number; sy?: number; cast?: boolean }) {
  return (
    <mesh position={p} scale={[1, sy, 1]} castShadow={cast} receiveShadow>
      <sphereGeometry args={[rad, 20, 14]} />
      <meshStandardMaterial color={c} roughness={rough} />
    </mesh>
  )
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, f)
  return `#${c.getHexString()}`
}

// ───────────────────────── furniture ─────────────────────────

function Chair({ dims: [w, h, d], color }: ModelProps) {
  const seatY = h * 0.5
  const leg = Math.min(w, d) * 0.08
  const wood = color
  const cushion = '#c9a98d'
  const lx = w / 2 - leg / 2
  const lz = d / 2 - leg / 2
  return (
    <group>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} p={[sx * lx, (sz < 0 ? h : seatY) / 2, sz * lz]} s={[leg, sz < 0 ? h : seatY, leg]} c={wood} />
      ))}
      <Box p={[0, seatY, 0]} s={[w, h * 0.06, d]} c={wood} />
      <Box p={[0, seatY + h * 0.045, 0.01]} s={[w * 0.86, h * 0.04, d * 0.86]} c={cushion} r={0.9} />
      <Box p={[0, h * 0.78, -d / 2 + leg / 2]} s={[w * 0.92, h * 0.34, leg * 0.8]} c={wood} />
      <Box p={[0, h * 0.78, -d / 2 + leg * 1.1]} s={[w * 0.72, h * 0.24, leg * 0.5]} c={cushion} r={0.9} />
    </group>
  )
}

function OfficeChair({ dims: [w, h, d], color }: ModelProps) {
  const seatY = h * 0.45
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return <Box key={i} p={[Math.cos(a) * w * 0.22, 0.05, Math.sin(a) * d * 0.22]} s={[w * 0.46, 0.04, 0.05]} c="#1c1f24" m={0.4} rot={[0, -a, 0]} />
      })}
      <Cyl p={[0, seatY / 2, 0]} rt={0.025} h={seatY} c="#7b8087" m={0.8} r={0.3} />
      <Box p={[0, seatY, 0]} s={[w * 0.82, 0.09, d * 0.82]} c={color} r={0.85} />
      <Box p={[0, h * 0.75, -d * 0.38]} s={[w * 0.8, h * 0.4, 0.07]} c={color} r={0.85} />
      <Box p={[-w * 0.46, seatY + 0.2, 0]} s={[0.05, 0.04, d * 0.5]} c="#1c1f24" />
      <Box p={[w * 0.46, seatY + 0.2, 0]} s={[0.05, 0.04, d * 0.5]} c="#1c1f24" />
    </group>
  )
}

function Bench({ dims: [w, h, d], color }: ModelProps) {
  const top = h * 0.12
  const legW = 0.05
  return (
    <group>
      <Box p={[0, h - top / 2, 0]} s={[w, top, d]} c={color} r={0.7} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box p={[s * (w / 2 - 0.1), (h - top) / 2, d / 2 - 0.05]} s={[legW, h - top, legW]} c="#4a4f57" m={0.6} />
          <Box p={[s * (w / 2 - 0.1), (h - top) / 2, -d / 2 + 0.05]} s={[legW, h - top, legW]} c="#4a4f57" m={0.6} />
        </group>
      ))}
      <Box p={[0, h * 0.3, 0]} s={[w - 0.2, 0.04, 0.04]} c="#4a4f57" m={0.6} />
    </group>
  )
}

function Desk({ dims: [w, h, d], color }: ModelProps) {
  const top = 0.04
  return (
    <group>
      <Box p={[0, h - top / 2, 0]} s={[w, top, d]} c={color} r={0.55} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} p={[sx * (w / 2 - 0.04), (h - top) / 2, sz * (d / 2 - 0.04)]} s={[0.05, h - top, 0.05]} c={shade(color, -0.18)} />
      ))}
      <Box p={[0, h - 0.12, -d / 2 + 0.03]} s={[w - 0.1, 0.18, 0.02]} c={shade(color, -0.12)} />
    </group>
  )
}

function DiningTable({ dims: [w, h, d], color }: ModelProps) {
  const top = 0.05
  return (
    <group>
      <Box p={[0, h - top / 2, 0]} s={[w, top, d]} c={color} r={0.35} />
      <Box p={[0, h - top - 0.04, 0]} s={[w - 0.3, 0.06, d - 0.3]} c={shade(color, -0.1)} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} p={[sx * (w / 2 - 0.1), (h - top) / 2, sz * (d / 2 - 0.1)]} s={[0.08, h - top, 0.08]} c={shade(color, -0.05)} />
      ))}
      {/* fruit bowl */}
      <Cyl p={[0, h + 0.03, 0]} rt={0.16} rb={0.1} h={0.06} c="#e9e4da" seg={18} />
      <Sphere p={[-0.04, h + 0.1, 0.02]} r={0.06} c="#e8b82d" />
      <Sphere p={[0.05, h + 0.1, -0.02]} r={0.06} c="#d65a31" />
      <Sphere p={[0, h + 0.15, 0.02]} r={0.055} c="#9bc53d" />
    </group>
  )
}

function CoffeeTable({ dims: [w, h, d], color }: ModelProps) {
  return (
    <group>
      <Box p={[0, h - 0.025, 0]} s={[w, 0.05, d]} c={color} r={0.2} />
      <Box p={[0, h * 0.25, 0]} s={[w * 0.9, 0.03, d * 0.85]} c={shade(color, -0.08)} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} p={[sx * (w / 2 - 0.05), (h - 0.05) / 2, sz * (d / 2 - 0.05)]} s={[0.04, h - 0.05, 0.04]} c="#9aa0a8" m={0.7} r={0.3} />
      ))}
      <Box p={[-0.1, h + 0.005, 0.04]} s={[0.28, 0.01, 0.2]} c="#f4f1e8" rot={[0, 0.15, 0]} />
      <Box p={[0.15, h + 0.012, -0.05]} s={[0.22, 0.02, 0.17]} c="#4a6fa5" rot={[0, -0.3, 0]} />
    </group>
  )
}

function Sofa({ dims: [w, h, d], color }: ModelProps) {
  const arm = 0.16
  const baseH = h * 0.32
  const seats = Math.max(1, Math.round(w / 0.65))
  const cw = (w - arm * 2) / seats
  const cushion = shade(color, 0.04)
  return (
    <group>
      <Box p={[0, baseH / 2 + 0.06, 0]} s={[w, baseH, d]} c={shade(color, -0.1)} r={0.9} />
      {Array.from({ length: seats }, (_, i) => (
        <Box key={i} p={[-w / 2 + arm + cw * (i + 0.5), baseH + 0.06 + 0.07, 0.07]} s={[cw - 0.02, 0.14, d - 0.2]} c={cushion} r={0.95} />
      ))}
      <Box p={[0, h * 0.62, -d / 2 + 0.1]} s={[w, h * 0.62, 0.2]} c={color} r={0.9} />
      {Array.from({ length: seats }, (_, i) => (
        <Box key={i} p={[-w / 2 + arm + cw * (i + 0.5), h * 0.68, -d / 2 + 0.26]} s={[cw - 0.04, h * 0.42, 0.14]} c={cushion} r={0.95} rot={[-0.18, 0, 0]} />
      ))}
      {[-1, 1].map((s) => (
        <Box key={s} p={[s * (w / 2 - arm / 2), h * 0.42, 0]} s={[arm, h * 0.6, d]} c={color} r={0.9} />
      ))}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Cyl key={i} p={[sx * (w / 2 - 0.1), 0.03, sz * (d / 2 - 0.1)]} rt={0.025} h={0.06} c="#2a2a2a" />
      ))}
      <Box p={[-w / 2 + arm + 0.2, baseH + 0.3, 0.0]} s={[0.36, 0.34, 0.12]} c="#e6a817" r={0.9} rot={[-0.2, 0.3, 0.05]} />
    </group>
  )
}

function Bed({ dims: [w, h, d], color }: ModelProps) {
  const frameH = h * 0.3
  const wood = '#6b4328'
  return (
    <group>
      <Box p={[0, frameH / 2 + 0.08, 0]} s={[w + 0.06, frameH, d + 0.04]} c={wood} r={0.6} />
      <Box p={[0, frameH + 0.08 + 0.1, 0]} s={[w - 0.04, 0.2, d - 0.08]} c="#f1ede6" r={0.95} />
      {/* blanket draped over the lower 2/3 */}
      <Box p={[0, frameH + 0.08 + 0.21, d * 0.16]} s={[w - 0.02, 0.05, d * 0.66]} c={color} r={0.95} />
      <Box p={[0, frameH + 0.08 + 0.15, d / 2 - 0.08]} s={[w - 0.02, 0.2, 0.08]} c={color} r={0.95} />
      {/* headboard */}
      <Box p={[0, h * 0.62, -d / 2 - 0.02]} s={[w + 0.08, h * 0.95, 0.08]} c={wood} r={0.55} />
      {/* pillows */}
      {[-1, 1].map((s) => (
        <Box key={s} p={[s * w * 0.24, frameH + 0.08 + 0.27, -d / 2 + 0.28]} s={[w * 0.38, 0.1, 0.4]} c="#fbfaf7" r={1} rot={[0.12, 0, 0]} />
      ))}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} p={[sx * (w / 2 - 0.04), 0.04, sz * (d / 2 - 0.04)]} s={[0.07, 0.08, 0.07]} c={wood} />
      ))}
    </group>
  )
}

function Cabinet({ dims: [w, h, d], color }: ModelProps) {
  const doors = Math.max(2, Math.round(w / 0.5))
  const dw = (w - 0.04) / doors
  return (
    <group>
      <Box p={[0, 0.04, 0]} s={[w, 0.08, d - 0.04]} c="#2b1b12" />
      <Box p={[0, h / 2 + 0.04, 0]} s={[w, h - 0.08, d]} c={color} r={0.55} />
      <Box p={[0, h - 0.015, 0]} s={[w + 0.03, 0.03, d + 0.03]} c={shade(color, -0.1)} r={0.5} />
      {Array.from({ length: doors }, (_, i) => (
        <group key={i}>
          <Box p={[-w / 2 + 0.02 + dw * (i + 0.5), h / 2 + 0.04, d / 2 + 0.003]} s={[dw - 0.012, h - 0.14, 0.012]} c={shade(color, 0.03)} r={0.5} />
          <Box p={[-w / 2 + 0.02 + dw * (i + 0.5) + (i % 2 ? -1 : 1) * dw * 0.38, h / 2 + 0.04, d / 2 + 0.025]} s={[0.015, 0.14, 0.02]} c="#c9ccd1" m={0.8} r={0.3} />
        </group>
      ))}
    </group>
  )
}

function Wardrobe({ dims: [w, h, d], color }: ModelProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} r={0.5} />
      <Box p={[-w / 4, h / 2, d / 2 + 0.004]} s={[w / 2 - 0.02, h - 0.12, 0.014]} c={shade(color, 0.04)} r={0.45} />
      <Box p={[w / 4, h / 2, d / 2 + 0.004]} s={[w / 2 - 0.02, h - 0.12, 0.014]} c={shade(color, 0.04)} r={0.45} />
      {[-1, 1].map((s) => (
        <Box key={s} p={[s * 0.04, h / 2, d / 2 + 0.03]} s={[0.018, 0.3, 0.02]} c="#c9ccd1" m={0.8} r={0.3} />
      ))}
      <Box p={[0, h + 0.01, 0]} s={[w + 0.04, 0.03, d + 0.03]} c={shade(color, -0.1)} />
    </group>
  )
}

function Bookshelf({ dims: [w, h, d], color }: ModelProps) {
  const shelves = 5
  const colors = ['#b5483a', '#3b6ea5', '#d9a441', '#4b8b5f', '#7a5aa6', '#e8e1d0']
  return (
    <group>
      <Box p={[-w / 2 + 0.015, h / 2, 0]} s={[0.03, h, d]} c={color} />
      <Box p={[w / 2 - 0.015, h / 2, 0]} s={[0.03, h, d]} c={color} />
      <Box p={[0, h / 2, -d / 2 + 0.006]} s={[w, h, 0.012]} c={shade(color, -0.1)} />
      {Array.from({ length: shelves + 1 }, (_, i) => (
        <Box key={i} p={[0, (i * (h - 0.03)) / shelves + 0.015, 0]} s={[w, 0.03, d]} c={color} />
      ))}
      {Array.from({ length: shelves }, (_, row) => {
        const y0 = (row * (h - 0.03)) / shelves + 0.03
        const bh = (h - 0.03) / shelves - 0.06
        let x = -w / 2 + 0.05
        const items: ReactElement[] = []
        let i = 0
        while (x < w / 2 - 0.12) {
          const bw = 0.03 + ((row * 7 + i * 13) % 5) * 0.012
          const bh2 = bh * (0.65 + (((row + i) * 17) % 4) * 0.1)
          items.push(<Box key={i} p={[x + bw / 2, y0 + bh2 / 2, 0]} s={[bw, bh2, d * 0.7]} c={colors[(row + i) % colors.length]} r={0.8} />)
          x += bw + 0.004
          i++
          if ((row + i) % 9 === 0) x += 0.25
        }
        return <group key={row}>{items}</group>
      })}
    </group>
  )
}

function Podium({ dims: [w, h, d], color }: ModelProps) {
  return (
    <group>
      <Box p={[0, 0.05, 0]} s={[w, 0.1, d]} c={shade(color, -0.1)} />
      <Box p={[0, h / 2, 0]} s={[w * 0.88, h - 0.1, d * 0.8]} c={color} r={0.5} />
      <Box p={[0, h - 0.02, 0.04]} s={[w, 0.05, d * 0.95]} c={shade(color, 0.06)} r={0.4} rot={[0.15, 0, 0]} />
      <Box p={[0, h - 0.03, d * 0.4]} s={[w * 0.6, 0.03, 0.03]} c="#b9a889" />
      <Cyl p={[0.12, h + 0.12, -0.06]} rt={0.005} h={0.25} c="#222" m={0.8} />
      <Sphere p={[0.12, h + 0.26, -0.06]} r={0.018} c="#222" />
    </group>
  )
}

function Plant({ dims: [w, h, d], color }: ModelProps) {
  const pot = h * 0.28
  const r = Math.min(w, d) / 2
  // deterministic leaf layout (no hooks, so the model can also be baked into merged geometry)
  const leaves = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2 * 2.3
    const t = i / 22
    return { a, y: pot + t * (h - pot) * 0.85, rad: r * (0.95 - t * 0.55), s: 0.16 + (1 - t) * 0.12, tone: ((i * 37) % 7) / 40 }
  })
  return (
    <group>
      <Cyl p={[0, pot / 2, 0]} rt={r * 0.85} rb={r * 0.6} h={pot} c="#b8683f" r={0.8} />
      <Cyl p={[0, pot - 0.01, 0]} rt={r * 0.78} h={0.03} c="#3b2a1d" r={1} />
      <Cyl p={[0, pot + (h - pot) * 0.35, 0]} rt={0.012} h={(h - pot) * 0.7} c="#5a7a3a" />
      {leaves.map((l, i) => (
        <Sphere key={i} p={[Math.cos(l.a) * l.rad * 0.7, l.y, Math.sin(l.a) * l.rad * 0.7]} r={l.s} c={shade(color, l.tone - 0.08)} sy={0.55} rough={0.65} />
      ))}
      <Sphere p={[0, h * 0.98, 0]} r={r * 0.35} c={shade(color, 0.04)} sy={0.7} />
    </group>
  )
}

function Carpet({ dims: [w, h, d], color }: ModelProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} r={1} cast={false} />
      <Box p={[0, h + 0.002, 0]} s={[w * 0.9, 0.004, d * 0.9]} c={shade(color, 0.12)} r={1} cast={false} />
      <Box p={[0, h + 0.004, 0]} s={[w * 0.8, 0.004, d * 0.8]} c={shade(color, -0.1)} r={1} cast={false} />
    </group>
  )
}

function Column({ dims: [w, h, d], color }: ModelProps) {
  return (
    <group>
      <Box p={[0, 0.1, 0]} s={[w * 1.2, 0.2, d * 1.2]} c={shade(color, -0.05)} />
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} r={0.85} />
      <Box p={[0, h - 0.08, 0]} s={[w * 1.2, 0.16, d * 1.2]} c={shade(color, -0.05)} />
    </group>
  )
}

// ───────────────────────── architecture ─────────────────────────

function Door({ dims: [w, h, d], color }: ModelProps) {
  const frame = '#d9d3c7'
  return (
    <group>
      <Box p={[-w / 2 + 0.03, h / 2, 0]} s={[0.06, h, d + 0.02]} c={frame} />
      <Box p={[w / 2 - 0.03, h / 2, 0]} s={[0.06, h, d + 0.02]} c={frame} />
      <Box p={[0, h - 0.03, 0]} s={[w, 0.06, d + 0.02]} c={frame} />
      <Box p={[0, (h - 0.06) / 2, 0]} s={[w - 0.12, h - 0.06, 0.045]} c={color} r={0.5} />
      <Box p={[0, (h - 0.06) / 2 + 0.3, 0.026]} s={[w - 0.34, 0.8, 0.012]} c={shade(color, 0.05)} r={0.5} />
      <Box p={[0, (h - 0.06) / 2 - 0.55, 0.026]} s={[w - 0.34, 0.55, 0.012]} c={shade(color, 0.05)} r={0.5} />
      <Cyl p={[w / 2 - 0.14, h * 0.48, 0.05]} rt={0.02} h={0.04} c="#c9a23a" m={0.9} r={0.3} rot={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

function WindowModel({ dims: [w, h, d], open }: ModelProps) {
  const frame = '#f2f2f0'
  const t = 0.05
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w + 0.12, 0.06, d + 0.06]} c={frame} />
      <Box p={[0, -0.03, 0.05]} s={[w + 0.2, 0.05, d + 0.16]} c={frame} />
      <Box p={[-w / 2, h / 2, 0]} s={[t, h, d * 0.6]} c={frame} />
      <Box p={[w / 2, h / 2, 0]} s={[t, h, d * 0.6]} c={frame} />
      <Box p={[0, h, 0]} s={[w + t, t, d * 0.6]} c={frame} />
      <Box p={[0, 0, 0]} s={[w + t, t, d * 0.6]} c={frame} />
      <Box p={[0, h / 2, 0]} s={[0.035, h, d * 0.5]} c={frame} />
      <mesh position={[open ? -w * 0.27 : -w * 0.25, h / 2, open ? 0.12 : 0]} rotation={[0, open ? 0.9 : 0, 0]}>
        <boxGeometry args={[w / 2 - 0.04, h - 0.06, 0.012]} />
        <meshPhysicalMaterial color="#bfe3ff" transparent opacity={0.3} roughness={0.05} transmission={0} />
      </mesh>
      <mesh position={[w * 0.25, h / 2, 0]}>
        <boxGeometry args={[w / 2 - 0.04, h - 0.06, 0.012]} />
        <meshPhysicalMaterial color="#bfe3ff" transparent opacity={0.3} roughness={0.05} />
      </mesh>
    </group>
  )
}

// ───────────────────────── devices ─────────────────────────

function CeilingFanModel({ dims: [w, h, d], glow = 0 }: ModelProps) {
  const r = Math.max(w, d) / 2
  return (
    <group>
      <Cyl p={[0, h - 0.03, 0]} rt={0.07} h={0.06} c="#d9d9d9" />
      <Cyl p={[0, h - 0.17, 0]} rt={0.012} h={0.22} c="#b7b7b7" />
      <Cyl p={[0, 0.07, 0]} rt={0.09} rb={0.11} h={0.1} c="#e9e9e9" r={0.4} />
      <group position={[0, 0.07, 0]} rotation={[0, glow * 1.2, 0]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]}>
            <Box p={[r * 0.55 + 0.06, 0, 0]} s={[r * 0.9, 0.012, 0.16]} c="#f4f4f4" r={0.5} rot={[0.08, 0, 0]} />
          </group>
        ))}
      </group>
    </group>
  )
}

function WallFanModel({ dims: [w, h, d], glow = 0 }: ModelProps) {
  const r = Math.min(w, h) / 2
  return (
    <group rotation={[0, 0, 0]}>
      <Box p={[0, h / 2, -d / 2 + 0.02]} s={[0.12, 0.2, 0.04]} c="#c9c9c9" />
      <Cyl p={[0, h / 2, -d / 2 + 0.1]} rt={0.05} h={0.14} c="#e5e5e5" rot={[Math.PI / 2, 0, 0]} />
      <Cyl p={[0, h / 2, 0.02]} rt={r} h={0.04} c="#f5f5f5" rot={[Math.PI / 2, 0, 0]} />
      <mesh position={[0, h / 2, 0.05]} rotation={[0, 0, glow * 2]}>
        <torusGeometry args={[r, 0.008, 6, 28]} />
        <meshStandardMaterial color="#9a9a9a" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, h / 2, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.9, r * 0.9, 0.012, 24]} />
        <meshStandardMaterial color="#8fb5d4" transparent opacity={0.25} />
      </mesh>
    </group>
  )
}

function SplitAC({ dims: [w, h, d], glow = 0 }: ModelProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c="#f5f7f9" r={0.35} />
      <Box p={[0, h * 0.18, d / 2 - 0.01]} s={[w - 0.1, h * 0.28, 0.04]} c="#e0e4e8" r={0.4} rot={[0.35, 0, 0]} />
      <Box p={[0, h * 0.32, d / 2 + 0.002]} s={[w - 0.12, 0.012, 0.01]} c="#cfd5db" />
      <Box p={[w * 0.36, h * 0.72, d / 2 + 0.005]} s={[0.07, 0.025, 0.01]} c={glow > 0 ? '#3ddc84' : '#6d7782'} />
      <Box p={[0, h - 0.015, 0]} s={[w + 0.01, 0.03, d + 0.01]} c="#fbfcfd" />
    </group>
  )
}

function AcVent({ dims: [w, h, d] }: ModelProps) {
  return (
    <group>
      <Box p={[0, h - 0.015, 0]} s={[w, 0.03, d]} c="#f2f4f6" r={0.4} />
      <Box p={[0, h - 0.05, 0]} s={[w * 0.82, 0.03, d * 0.82]} c="#e4e8ec" r={0.4} />
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={i} p={[0, h - 0.08, -d * 0.3 + (i * d * 0.6) / 5]} s={[w * 0.7, 0.012, 0.018]} c="#c3c9d0" />
      ))}
    </group>
  )
}

function CeilingLight({ dims: [w, h, d], glow = 0 }: ModelProps) {
  return (
    <group>
      <Box p={[0, h - 0.01, 0]} s={[w + 0.04, 0.02, d + 0.04]} c="#e9e9e9" />
      <mesh position={[0, h - 0.03, 0]}>
        <boxGeometry args={[w, 0.02, d]} />
        <meshStandardMaterial color="#fffbe6" emissive="#ffe9a8" emissiveIntensity={glow * 2.2} roughness={0.4} />
      </mesh>
    </group>
  )
}

function BulbModel({ dims: [w, h], glow = 0 }: ModelProps) {
  return (
    <group>
      <Cyl p={[0, h - 0.015, 0]} rt={0.04} h={0.03} c="#d4d4d4" />
      <Cyl p={[0, h - 0.14, 0]} rt={0.005} h={0.2} c="#222" />
      <Cyl p={[0, 0.17, 0]} rt={0.03} h={0.06} c="#b7b7b7" m={0.7} />
      <mesh position={[0, 0.07, 0]}>
        <sphereGeometry args={[w * 0.5, 18, 14]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffd666" emissiveIntensity={glow * 3} transparent opacity={0.92} />
      </mesh>
    </group>
  )
}

function TubeLight({ dims: [w, h, d], glow = 0 }: ModelProps) {
  return (
    <group>
      <Box p={[0, h - 0.015, 0]} s={[w, 0.03, d]} c="#d9d9d9" />
      <mesh position={[0, h - 0.04, 0]}>
        <cylinderGeometry args={[0.022, 0.022, w * 0.95, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={glow * 2.4} />
      </mesh>
      <group rotation={[0, 0, Math.PI / 2]} />
    </group>
  )
}

function Lamp({ dims: [w, h], glow = 0 }: ModelProps) {
  return (
    <group>
      <Cyl p={[0, 0.02, 0]} rt={w * 0.38} h={0.04} c="#2d2d2d" m={0.5} />
      <Cyl p={[0, h * 0.4, 0]} rt={0.012} h={h * 0.8} c="#3a3a3a" m={0.6} />
      <mesh position={[0, h * 0.86, 0]}>
        <cylinderGeometry args={[w * 0.28, w * 0.46, h * 0.22, 22, 1, true]} />
        <meshStandardMaterial color="#f3e3b0" emissive="#ffd98a" emissiveIntensity={glow * 1.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export const MODELS: Record<ObjectKind, (p: ModelProps) => ReactElement> = {
  chair: Chair,
  officeChair: OfficeChair,
  bench: Bench,
  desk: Desk,
  diningTable: DiningTable,
  coffeeTable: CoffeeTable,
  sofa: Sofa,
  bed: Bed,
  cabinet: Cabinet,
  wardrobe: Wardrobe,
  bookshelf: Bookshelf,
  podium: Podium,
  plant: Plant,
  carpet: Carpet,
  door: Door,
  window: WindowModel,
  column: Column,
  ceilingFan: CeilingFanModel,
  wallFan: WallFanModel,
  splitAC: SplitAC,
  acVent: AcVent,
  ceilingLight: CeilingLight,
  bulb: BulbModel,
  tubeLight: TubeLight,
  lamp: Lamp,
}

export const ObjectModel = memo(function ObjectModel({ kind, ...props }: ModelProps & { kind: ObjectKind }) {
  const M = MODELS[kind]
  return <M {...props} />
})

/** A seated low-poly person. Origin at the seat surface, facing local +z. */
export const Person = memo(function Person({ tint = '#3b82f6', skin = '#e0b48c' }: { tint?: string; skin?: string }) {
  const legs = '#2f3b52'
  return (
    <group>
      {/* thighs */}
      <Box p={[-0.09, 0.05, 0.17]} s={[0.11, 0.1, 0.38]} c={legs} r={0.8} />
      <Box p={[0.09, 0.05, 0.17]} s={[0.11, 0.1, 0.38]} c={legs} r={0.8} />
      {/* shins */}
      <Box p={[-0.09, -0.19, 0.34]} s={[0.1, 0.4, 0.1]} c={legs} r={0.8} />
      <Box p={[0.09, -0.19, 0.34]} s={[0.1, 0.4, 0.1]} c={legs} r={0.8} />
      <Box p={[-0.09, -0.4, 0.4]} s={[0.1, 0.06, 0.2]} c="#1f2430" />
      <Box p={[0.09, -0.4, 0.4]} s={[0.1, 0.06, 0.2]} c="#1f2430" />
      {/* torso */}
      <Box p={[0, 0.37, 0]} s={[0.36, 0.5, 0.2]} c={tint} r={0.85} />
      {/* arms */}
      <Box p={[-0.23, 0.38, 0.06]} s={[0.08, 0.34, 0.1]} c={tint} r={0.85} rot={[-0.5, 0, 0]} />
      <Box p={[0.23, 0.38, 0.06]} s={[0.08, 0.34, 0.1]} c={tint} r={0.85} rot={[-0.5, 0, 0]} />
      {/* head */}
      <Cyl p={[0, 0.67, 0]} rt={0.05} h={0.08} c={skin} />
      <Sphere p={[0, 0.78, 0.01]} r={0.115} c={skin} rough={0.8} />
      <Sphere p={[0, 0.82, -0.02]} r={0.118} c="#2a1d14" rough={0.9} sy={0.75} />
    </group>
  )
})
