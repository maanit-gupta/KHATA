import { t } from '../../strings'

/** The ▶ square play control (DESIGN.md §6.3, §6.9). 48×48 hit area. */
export function PlayButton({ onClick, label = t.ledger.play, dark = false, disabled = false }:
  { onClick: () => void; label?: string; dark?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className={`inline-flex size-12 shrink-0 items-center justify-center disabled:opacity-40 ${dark ? 'bg-paper text-ink' : 'bg-ink text-paper'}`}>
      <span aria-hidden className="text-[14px] leading-none">▶</span>
    </button>
  )
}
