import { X, Wind, Snowflake, Sun, Users, Thermometer, ShieldCheck, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'
import { cn } from '@/lib/utils'

export function ZoneDetailCard() {
  const selectedZoneId = useSim((s) => s.selectedZoneId)
  const setSelectedZoneId = useSim((s) => s.setSelectedZoneId)
  const snap = useSim((s) => s.snapshot)
  const space = useEditor((s) => s.space)

  if (!selectedZoneId || !snap || !space) return null

  const zone = snap.zones.find((z) => z.id === selectedZoneId)
  if (!zone) return null

  const stats = snap.zoneStats.find((s) => s.id === selectedZoneId)
  const objects = space.objects ?? []
  const sensors = space.hardware?.sensors ?? []

  const ac = objects.find((o) => o.id === zone.acId)
  const fan = objects.find((o) => o.id === zone.fanId)
  const lights = zone.lightIds
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
  const zoneSensors = sensors.filter((s) => zone.sensorIds?.includes(s.id))
  const otherDevices = (zone.deviceIds ?? [])
    .filter((id) => id !== zone.acId && id !== zone.fanId && !zone.lightIds.includes(id))
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))

  return (
    <div className="absolute right-4 top-16 z-30 w-80 rounded-xl border border-slate-200/90 bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
            <h3 className="font-semibold text-slate-900 text-sm">{zone.label ?? `Zone ${zone.id}`}</h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Area: {zone.area.toFixed(1)} m² · {zone.cellCount} grid cells
          </p>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => setSelectedZoneId(null)}
          className="h-6 w-6 text-slate-400 hover:text-slate-700"
          aria-label="Close zone details"
        >
          <X size={14} />
        </Button>
      </div>

      <div className="mt-3 space-y-3 text-[12px]">
        {/* Parent AC & Fan Hierarchy */}
        <div className="rounded-lg bg-slate-50 p-2.5 space-y-2 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium text-slate-600 text-[11.5px]">
              <Snowflake size={13} className="text-blue-500" />
              Parent AC Zone
            </span>
            <span className="font-semibold text-slate-800 text-[11.5px]">
              {zone.acZoneId != null ? `AC Zone ${zone.acZoneId}` : 'None'}
            </span>
          </div>
          {ac && (
            <p className="text-[11px] text-slate-500 pl-5">
              Assigned: <span className="font-medium text-slate-700">{ac.name}</span>
            </p>
          )}

          <div className="flex items-center justify-between border-t border-slate-200/60 pt-1.5">
            <span className="flex items-center gap-1.5 font-medium text-slate-600 text-[11.5px]">
              <Wind size={13} className="text-emerald-500" />
              Fan Subzone
            </span>
            <span className="font-semibold text-slate-800 text-[11.5px]">
              {zone.fanSubzoneId != null ? `Fan Subzone ${zone.fanSubzoneId}` : 'None'}
            </span>
          </div>
          {fan && (
            <p className="text-[11px] text-slate-500 pl-5">
              Assigned: <span className="font-medium text-slate-700">{fan.name}</span>
            </p>
          )}
        </div>

        {/* Environmental Metrics */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-md border border-slate-100 bg-slate-50/70 p-2">
            <div className="flex items-center gap-1 text-slate-500 mb-0.5">
              <Thermometer size={12} className="text-red-500" />
              <span>Temperature</span>
            </div>
            <div className="font-semibold text-slate-800 text-sm">
              {stats ? `${stats.avgT.toFixed(1)} °C` : '—'}
            </div>
            {stats && (
              <div className="text-[10px] text-slate-400">
                Feels {stats.avgPerceivedT.toFixed(1)} °C
              </div>
            )}
          </div>

          <div className="rounded-md border border-slate-100 bg-slate-50/70 p-2">
            <div className="flex items-center gap-1 text-slate-500 mb-0.5">
              <Sun size={12} className="text-amber-500" />
              <span>Lighting</span>
            </div>
            <div className="font-semibold text-slate-800 text-sm">
              {stats ? `${Math.round(stats.avgLux)} lx` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">
              {zone.lightIds.length} light(s) located
            </div>
          </div>

          <div className="rounded-md border border-slate-100 bg-slate-50/70 p-2">
            <div className="flex items-center gap-1 text-slate-500 mb-0.5">
              <Users size={12} className="text-indigo-500" />
              <span>Occupancy</span>
            </div>
            <div className="font-semibold text-slate-800 text-sm">
              {stats?.occupants ?? 0} seated
            </div>
            <div className="text-[10px] text-slate-400">
              {stats?.comfortable ? 'Comfortable' : 'Uncomfortable'}
            </div>
          </div>

          <div className="rounded-md border border-slate-100 bg-slate-50/70 p-2">
            <div className="flex items-center gap-1 text-slate-500 mb-0.5">
              <ShieldCheck size={12} className="text-emerald-500" />
              <span>Coverage</span>
            </div>
            <div className="font-semibold text-slate-800 text-xs uppercase">
              <span
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[9.5px]',
                  zone.coverage === 'cooled'
                    ? 'bg-emerald-100 text-emerald-800'
                    : zone.coverage === 'fan-only'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                )}
              >
                {zone.coverage}
              </span>
            </div>
          </div>
        </div>

        {/* Devices located in this zone */}
        <div className="border-t border-slate-100 pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span className="flex items-center gap-1">
              <Cpu size={12} />
              Devices Located in Zone ({zone.lightIds.length + (ac ? 1 : 0) + (fan ? 1 : 0) + zoneSensors.length})
            </span>
          </div>

          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {ac && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200/60">
                {ac.name}
              </span>
            )}
            {fan && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200/60">
                {fan.name}
              </span>
            )}
            {lights.map((l) => (
              <span
                key={l.id}
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200/60"
              >
                {l.name}
              </span>
            ))}
            {zoneSensors.map((s) => (
              <span
                key={s.id}
                className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 border border-purple-200/60"
              >
                {s.name}
              </span>
            ))}
            {otherDevices.map((d) => (
              <span
                key={d.id}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200"
              >
                {d.name}
              </span>
            ))}
            {!ac && !fan && lights.length === 0 && zoneSensors.length === 0 && otherDevices.length === 0 && (
              <span className="text-[10.5px] text-slate-400 italic">No devices inside this zone</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
