import { Field, NumberInput, Section, SelectBox, Slider, Toggle } from '@/components/ui/controls'
import { SimControls } from '@/components/simulation/SimControls'
import { LIGHTING_PRESETS } from '@/simulation/scenario'
import { activeScenario, useEditor } from '@/store/editorStore'
import { useSim } from '@/store/simStore'
import type { LightingPreset, Resolution } from '@/types'

function Badge({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 text-[12px] ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      <div className="flex items-center gap-1.5 font-medium"><span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />{label}</div>
      {detail && <div className="mt-0.5 text-[11px] opacity-80">{detail}</div>}
    </div>
  )
}

export function SimulatePanel() {
  const space = useEditor((s) => s.space!)
  const sc = activeScenario(space)
  const update = useEditor((s) => s.updateScenario)
  const snap = useSim((s) => s.snapshot)
  const st = snap?.stats
  const sim = sc.sim
  const setSim = (p: Partial<typeof sim>) => update(sc.id, { sim: { ...sim, ...p } })
  return (
    <>
      <Section title="Run"><SimControls /></Section>
      {st && (
        <Section title="Comfort status">
          <Badge ok={st.comfort.averageTargetReached} label="Average temperature on target" detail={`${st.avgT.toFixed(1)} °C vs ${sc.targetTempC} °C`} />
          <Badge ok={st.comfort.occupiedComfort} label={`Occupied zones within ±${sim.toleranceC} °C`} detail={st.occupants ? `${snap!.zoneStats.filter((z) => z.occupants && z.comfortable).length} of ${snap!.zoneStats.filter((z) => z.occupants).length} occupied zones comfortable` : 'No occupants yet'} />
          <Badge ok={st.comfort.uniform} label="Thermal uniformity" detail={`Spread across occupied zones: ${st.comfort.spread.toFixed(1)} °C`} />
        </Section>
      )}
      <Section title="Temperature">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Initial indoor air (°C)"><NumberInput value={sc.initialTempC} step={0.5} min={5} max={50} onCommit={(initialTempC) => update(sc.id, { initialTempC })} /></Field>
          <Field label="Outside (°C)"><NumberInput value={sc.outsideTempC} step={0.5} min={-20} max={55} onCommit={(outsideTempC) => update(sc.id, { outsideTempC })} /></Field>
          <Field label="Target (°C)"><NumberInput value={sc.targetTempC} step={0.5} min={16} max={32} onCommit={(targetTempC) => update(sc.id, { targetTempC })} /></Field>
          <Field label="Tolerance ± (°C)"><NumberInput value={sim.toleranceC} step={0.25} min={0.25} max={5} onCommit={(toleranceC) => setSim({ toleranceC })} /></Field>
        </div>
      </Section>
      <Section title="Lighting scenario">
        <Field label="Preset">
          <SelectBox<LightingPreset> value={sc.lighting.preset} onChange={(preset) => {
            if (preset === 'custom') return update(sc.id, { lighting: { ...sc.lighting, preset } })
            const p = LIGHTING_PRESETS[preset]
            update(sc.id, { lighting: { preset, timeOfDay: (p.time[0] + p.time[1]) / 2, cloudCover: (p.cloud[0] + p.cloud[1]) / 2 } })
          }} options={[...Object.entries(LIGHTING_PRESETS).map(([value, p]) => ({ value: value as LightingPreset, label: p.label })), { value: 'custom', label: 'Custom' }]} />
        </Field>
        <Field label={`Time of day ${Math.floor(sc.lighting.timeOfDay)}:${String(Math.round((sc.lighting.timeOfDay % 1) * 60)).padStart(2, '0')}`}><Slider value={sc.lighting.timeOfDay} min={0} max={24} step={0.25} onChange={() => undefined} onCommit={(timeOfDay) => update(sc.id, { lighting: { ...sc.lighting, preset: 'custom', timeOfDay } })} /></Field>
        <Field label={`Cloud cover ${Math.round(sc.lighting.cloudCover * 100)}%`}><Slider value={sc.lighting.cloudCover} min={0} max={1} step={0.05} onChange={() => undefined} onCommit={(cloudCover) => update(sc.id, { lighting: { ...sc.lighting, preset: 'custom', cloudCover } })} /></Field>
        <Field label="Target indoor light (lux)"><NumberInput value={sc.targetLux} step={50} min={0} max={1500} digits={0} onCommit={(targetLux) => update(sc.id, { targetLux })} /></Field>
        <Toggle checked={sc.autoLighting} onChange={(autoLighting) => update(sc.id, { autoLighting })} label="Automatic lighting control" />
        {st && <div className="text-[11px] text-slate-500">Outdoor ≈ {Math.round(st.outdoorLux).toLocaleString()} lx · indoor average {Math.round(st.avgLux)} lx</div>}
      </Section>
      <Section title="Thermal model (advanced)">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Thermal mass ×air" hint="Ceff = multiple of air-only capacity"><NumberInput value={sim.thermalMassMultiplier} step={0.5} min={1} max={50} onCommit={(thermalMassMultiplier) => setSim({ thermalMassMultiplier })} /></Field>
          <Field label="Ceff override (J/K)"><NumberInput value={sim.ceffOverride ?? 0} step={100000} min={0} digits={0} onCommit={(v) => setSim({ ceffOverride: v > 0 ? v : undefined })} /></Field>
          <Field label="Envelope U (W/m²K)"><NumberInput value={sim.envelopeU} step={0.1} min={0} max={5} onCommit={(envelopeU) => setSim({ envelopeU })} /></Field>
          <Field label="Equipment (W)"><NumberInput value={sim.equipmentW} step={100} min={0} digits={0} onCommit={(equipmentW) => setSim({ equipmentW })} /></Field>
          <Field label="Air density (kg/m³)"><NumberInput value={sim.airDensity} step={0.05} min={0.8} max={1.4} onCommit={(airDensity) => setSim({ airDensity })} /></Field>
          <Field label="Grid resolution"><SelectBox<Resolution> value={sim.resolution} onChange={(resolution) => setSim({ resolution })} options={[{ value: 'coarse', label: 'Coarse' }, { value: 'standard', label: 'Standard' }, { value: 'fine', label: 'Fine' }]} /></Field>
        </div>
        <Toggle checked={sim.educationalAcOffset} onChange={(educationalAcOffset) => setSim({ educationalAcOffset })} label="Educational mode: show AC offsets as perceived cooling" />
        <p className="text-[11px] leading-snug text-slate-400">Air-only capacity underestimates the real load; walls, floor and furniture store heat too, hence the thermal-mass multiplier.</p>
      </Section>
      {st && st.warnings.length > 0 && (
        <Section title="Warnings">
          {st.warnings.map((w) => <div key={w} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">{w}</div>)}
        </Section>
      )}
    </>
  )
}
