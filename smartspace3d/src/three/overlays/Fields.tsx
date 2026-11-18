import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { SimSnapshot } from '@/simulation/types'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'
import { LUX_MAX, luxColor, tempColor, tempRange, ZONE_PALETTE, type RGB } from './colors'

function fillTexture(data: Uint8Array, snap: SimSnapshot, layer: string, target: number) {
  const { nx, nz } = snap
  const [lo, hi] = tempRange(snap, target)
  for (let iz = 0; iz < nz; iz++) {
    const row = nz - 1 - iz // texture row 0 is the south edge
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix
      const k = (row * nx + ix) * 4
      let c: RGB = [0, 0, 0]
      let a = 0
      if (layer === 'temperature') {
        c = tempColor((snap.temp[i] - lo) / (hi - lo))
        a = 0.66
      } else if (layer === 'lighting') {
        c = luxColor(snap.lux[i] / LUX_MAX)
        a = 0.7
      } else if (layer === 'occupancy') {
        const n = snap.occupantsByCell[i]
        if (n > 0) {
          c = tempColor(0.55 + Math.min(1, n / 4) * 0.45)
          a = 0.7
        }
      } else if (layer === 'zones') {
        const z = snap.zoneIdByCell[i]
        c = ZONE_PALETTE[Math.abs(z) % ZONE_PALETTE.length]
        a = 0.3
      }
      data[k] = c[0]
      data[k + 1] = c[1]
      data[k + 2] = c[2]
      data[k + 3] = a * 255
    }
  }
}

/** Heat-map drawn over the floor from the simulation grid (nx × nz cells), independent of render size. */
export function FieldOverlay() {
  const layer = useEditor((s) => s.layer)
  const dims = useEditor((s) => s.space!.dims)
  const target = useEditor((s) => activeScenario(s.space!).targetTempC)
  const snap = useSim((s) => s.snapshot)
  const active = layer === 'temperature' || layer === 'lighting' || layer === 'occupancy' || layer === 'zones'
  const nx = snap?.nx ?? 1
  const nz = snap?.nz ?? 1
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(nx * nz * 4), nx, nz, THREE.RGBAFormat)
    t.magFilter = layer === 'zones' || layer === 'occupancy' ? THREE.NearestFilter : THREE.LinearFilter
    t.minFilter = t.magFilter
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [nx, nz, layer])
  useEffect(() => {
    if (!snap || !active) return
    fillTexture(tex.image.data as Uint8Array, snap, layer, target)
    tex.needsUpdate = true
  }, [snap, tex, layer, target, active])
  useEffect(() => () => tex.dispose(), [tex])
  if (!active || !snap) return null
  return (
    <mesh position={[dims.length / 2, 0.012, dims.width / 2]} rotation-x={-Math.PI / 2} renderOrder={1}>
      <planeGeometry args={[dims.length, dims.width]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Zone boundaries + labels (occupants, average temperature, light level, coverage). */
export function ZoneLayer() {
  const layer = useEditor((s) => s.layer)
  const dims = useEditor((s) => s.space!.dims)
  const snap = useSim((s) => s.snapshot)
  const geo = useMemo(() => {
    if (!snap || layer !== 'zones') return null
    const { nx, nz, zoneIdByCell: z } = snap
    const dx = dims.length / nx
    const dz = dims.width / nz
    const pts: number[] = []
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix
        if (ix + 1 < nx && z[i] !== z[i + 1]) pts.push((ix + 1) * dx, 0.03, iz * dz, (ix + 1) * dx, 0.03, (iz + 1) * dz)
        if (iz + 1 < nz && z[i] !== z[i + nx]) pts.push(ix * dx, 0.03, (iz + 1) * dz, (ix + 1) * dx, 0.03, (iz + 1) * dz)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [snap, layer, dims.length, dims.width])
  useEffect(() => () => geo?.dispose(), [geo])
  if (layer !== 'zones' || !snap || !geo) return null
  return (
    <group>
      <lineSegments geometry={geo} renderOrder={3}>
        <lineBasicMaterial color="#0f172a" transparent opacity={0.75} depthTest={false} />
      </lineSegments>
      {snap.zones.map((zi) => {
        const st = snap.zoneStats.find((s) => s.id === zi.id)
        const col = ZONE_PALETTE[Math.abs(zi.id) % ZONE_PALETTE.length]
        return (
          <Html key={zi.id} position={[zi.cx, 0.4, zi.cz]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
            <div className="whitespace-nowrap rounded border bg-white/95 px-1 py-px text-[9px] font-medium leading-tight text-slate-800 shadow-sm" style={{ borderColor: `rgb(${col.join(',')})` }} title={`Zone ${zi.id + 1} · ${zi.coverage} · ${zi.acIds.length} AC, ${zi.fanIds.length} fan, ${zi.lightIds.length} light`}>
              Z{zi.id + 1}{st ? ` · ${st.occupants}p · ${st.avgT.toFixed(1)}°` : ''}{zi.coverage === 'uncovered' ? ' ⚠' : ''}
            </div>
          </Html>
        )
      })}
    </group>
  )
}

/** Rings under each occupant coloured by how well the environment devices cover them. */
export function CoverageLayer() {
  const layer = useEditor((s) => s.layer)
  const occupants = useEditor((s) => activeScenario(s.space!).occupants)
  const snap = useSim((s) => s.snapshot)
  if (layer !== 'coverage' || !snap) return null
  const byId = new Map(occupants.map((o) => [o.id, o]))
  const COL = { covered: '#16a34a', partial: '#f59e0b', uncovered: '#dc2626' } as const
  return (
    <group>
      {snap.coverage.map((c) => {
        const o = byId.get(c.occupantId)
        if (!o) return null
        return (
          <mesh key={c.occupantId} position={[o.position[0], 0.04, o.position[2]]} rotation-x={-Math.PI / 2} renderOrder={4}>
            <ringGeometry args={[0.3, 0.4, 24]} />
            <meshBasicMaterial color={COL[c.status]} depthTest={false} transparent opacity={0.95} />
          </mesh>
        )
      })}
    </group>
  )
}
