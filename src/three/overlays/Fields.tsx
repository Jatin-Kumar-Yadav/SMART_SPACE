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
        const zid = snap.zoneIdByCell[i]
        const zi = snap.zones.find((x) => x.id === zid)
        if (zi) {
          if (zi.acZoneId != null) {
            // Parent AC zone defines the primary hue family
            const baseCol = ZONE_PALETTE[(zi.acZoneId - 1) % ZONE_PALETTE.length]
            // Fan subzones have subtle variations in brightness
            const sub = zi.fanSubzoneId ?? 1
            const factor = 0.82 + ((sub * 43) % 36) / 100
            c = [
              Math.min(255, Math.round(baseCol[0] * factor)),
              Math.min(255, Math.round(baseCol[1] * factor)),
              Math.min(255, Math.round(baseCol[2] * factor)),
            ]
          } else {
            c = ZONE_PALETTE[Math.abs(zid - 1) % ZONE_PALETTE.length]
          }
          a = 0.32
        } else {
          c = [148, 163, 184]
          a = 0.15
        }
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
  const selectedZoneId = useSim((s) => s.selectedZoneId)
  const setSelectedZoneId = useSim((s) => s.setSelectedZoneId)

  const { primaryGeo, subzoneGeo } = useMemo(() => {
    if (!snap || layer !== 'zones') return { primaryGeo: null, subzoneGeo: null }
    const { nx, nz, zoneIdByCell: z, zones } = snap
    const zoneMap = new Map(zones.map((x) => [x.id, x]))
    const dx = dims.length / nx
    const dz = dims.width / nz
    const primaryPts: number[] = []
    const subzonePts: number[] = []

    const addEdge = (isPrimary: boolean, x1: number, z1: number, x2: number, z2: number) => {
      const target = isPrimary ? primaryPts : subzonePts
      const y = isPrimary ? 0.035 : 0.03
      target.push(x1, y, z1, x2, y, z2)
    }

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix
        const id1 = z[i]
        const z1 = zoneMap.get(id1)

        // East neighbor
        if (ix + 1 < nx) {
          const id2 = z[i + 1]
          if (id1 !== id2) {
            const z2 = zoneMap.get(id2)
            const isPrimary = (z1?.acZoneId ?? null) !== (z2?.acZoneId ?? null)
            addEdge(isPrimary, (ix + 1) * dx, iz * dz, (ix + 1) * dx, (iz + 1) * dz)
          }
        }

        // South neighbor
        if (iz + 1 < nz) {
          const id2 = z[i + nx]
          if (id1 !== id2) {
            const z2 = zoneMap.get(id2)
            const isPrimary = (z1?.acZoneId ?? null) !== (z2?.acZoneId ?? null)
            addEdge(isPrimary, ix * dx, (iz + 1) * dz, (ix + 1) * dx, (iz + 1) * dz)
          }
        }
      }
    }

    const gPrimary = new THREE.BufferGeometry()
    gPrimary.setAttribute('position', new THREE.Float32BufferAttribute(primaryPts, 3))

    const gSubzone = new THREE.BufferGeometry()
    gSubzone.setAttribute('position', new THREE.Float32BufferAttribute(subzonePts, 3))

    return { primaryGeo: gPrimary, subzoneGeo: gSubzone }
  }, [snap, layer, dims.length, dims.width])

  useEffect(() => () => {
    primaryGeo?.dispose()
    subzoneGeo?.dispose()
  }, [primaryGeo, subzoneGeo])

  if (layer !== 'zones' || !snap || (!primaryGeo && !subzoneGeo)) return null

  return (
    <group>
      {/* Primary AC Zone Boundaries (Bold solid lines) */}
      {primaryGeo && (
        <lineSegments geometry={primaryGeo} renderOrder={4}>
          <lineBasicMaterial color="#020617" transparent opacity={0.92} depthTest={false} />
        </lineSegments>
      )}

      {/* Fan Subzone Boundaries (Lighter distinguishing lines) */}
      {subzoneGeo && (
        <lineSegments geometry={subzoneGeo} renderOrder={3}>
          <lineBasicMaterial color="#475569" transparent opacity={0.55} depthTest={false} />
        </lineSegments>
      )}

      {snap.zones.map((zi) => {
        const st = snap.zoneStats.find((s) => s.id === zi.id)
        const isSelected = zi.id === selectedZoneId
        const col = zi.acZoneId != null
          ? ZONE_PALETTE[(zi.acZoneId - 1) % ZONE_PALETTE.length]
          : ZONE_PALETTE[Math.abs(zi.id - 1) % ZONE_PALETTE.length]

        const titleText = `${zi.label ?? `Zone ${zi.id}`}
Parent AC: ${zi.acName ?? 'None'}
Assigned Fan: ${zi.fanName ?? 'None'}
Lights located in zone: ${zi.lightIds.length}
Sensors located in zone: ${zi.sensorIds?.length ?? 0}
Click to view full zone details`

        return (
          <Html key={zi.id} position={[zi.cx, 0.45, zi.cz]} center style={{ pointerEvents: 'auto' }} zIndexRange={[20, 0]}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedZoneId(isSelected ? null : zi.id)
              }}
              className={`cursor-pointer whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold leading-tight shadow-md transition-all hover:scale-105 active:scale-95 ${
                isSelected
                  ? 'bg-slate-900 text-white ring-2 ring-blue-500 ring-offset-1'
                  : 'bg-white/95 text-slate-800 hover:bg-slate-50'
              }`}
              style={{ borderColor: `rgb(${col.join(',')})` }}
              title={titleText}
            >
              <span>{zi.label ?? `Zone ${zi.id}`}</span>
              {st && <span className="ml-1 font-normal opacity-75">· {st.occupants}p · {st.avgT.toFixed(1)}°</span>}
              {zi.coverage === 'uncovered' && <span className="ml-0.5 text-amber-500 font-bold">⚠</span>}
            </button>
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
