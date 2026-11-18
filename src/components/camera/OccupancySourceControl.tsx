import { Camera, Cpu, Dices, Hand } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { chooseOccupancySource } from '@/store/cameraStore'
import { activeScenario, useEditor } from '@/store/editorStore'
import type { OccupancySource } from '@/types'

const OPTIONS: { id: OccupancySource; label: string; hint: string; Icon: typeof Dices; disabled?: boolean }[] = [
  { id: 'random', label: 'Random', hint: 'People are generated at random seats (existing generator).', Icon: Dices },
  { id: 'manual', label: 'Manual', hint: 'A fixed number or percentage of seats that you choose.', Icon: Hand },
  { id: 'camera', label: 'Camera', hint: 'Seats confirmed by the Live Camera mode. Generation is locked while this is active.', Icon: Camera },
  { id: 'iot', label: 'IoT', hint: 'Reserved: a PIR sensor reports motion, not which seats are taken, so it cannot drive seat-level occupancy yet.', Icon: Cpu, disabled: true },
]

/**
 * Exactly one occupancy source is authoritative. Switching never mixes data: the camera stashes the
 * generated occupants and gives them back untouched when it is switched off.
 */
export function OccupancySourceControl({ compact = false }: { compact?: boolean }) {
  const source = useEditor((s) => activeScenario(s.space!).occupancySource)
  return (
    <div>
      <div role="radiogroup" aria-label="Occupancy source" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-0.5">
        {OPTIONS.map(({ id, label, hint, Icon, disabled }) => (
          <Tip key={id} label={hint} side="bottom">
            <button
              role="radio"
              aria-checked={source === id}
              disabled={disabled}
              onClick={() => chooseOccupancySource(id)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                source === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          </Tip>
        ))}
      </div>
      {!compact && (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          {source === 'camera' ? 'The camera is the only source of occupants. Random generation is locked.' : 'Only one source is authoritative at a time. Switching to Camera keeps your generated people and restores them when you switch back.'}
        </p>
      )}
    </div>
  )
}
