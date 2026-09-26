import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { t } from '../../strings/en'
import { StatusSquare, type Status } from './StatusSquare'

type RowProps = {
  status: Status
  /** Main content, starts at the 1/3 mark. */
  children: ReactNode
  /** Right column: amount or name, right-aligned. */
  right?: ReactNode
  auto?: boolean
  isNew?: boolean
  dark?: boolean
  /** Position in its list; staggers the line draw by 120ms per row. */
  index?: number
  /** From useReveal: whether to play the one-time line draw. */
  animate?: boolean
  onClick?: () => void
  /** With onClick: render as a radio option (e.g. the language picker). */
  checked?: boolean
  as?: 'div' | 'li'
  /** Controls beside the row's tap target (e.g. evidence ▶ / →), so buttons never nest. */
  aside?: ReactNode
}

const EASE = [0.65, 0, 0.35, 1] as const
const LINE_MS = 900
const STAGGER_MS = 120
// Strike leaf elements only. A decoration is drawn with the metrics of the element that sets it,
// so a 15px wrapper around a 40px amount would put the line near the amount's top.
const STRIKE = '[&_*:not(:has(*))]:line-through'

/**
 * Full-width hairline row with three aligned columns (DESIGN.md §5). Motion (§8): the hairline
 * draws left→right over 900ms, text wipes in with it, then the square pops 0.05→1 in 300ms.
 */
export function Row({ status, children, right, auto, isNew, dark = false, index = 0, animate = false, onClick, checked, as = 'div', aside }: RowProps) {
  const delay = (index * STAGGER_MS) / 1000
  const voided = status === 'voided'
  const Tag = as === 'li' ? motion.li : motion.div
  const body = (
    <>
      <span className="flex items-center gap-2 pt-[3px]">
        <motion.span
          className="inline-flex"
          style={{ originX: 0 }}
          initial={animate ? { scaleX: 0.05 } : false}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.3, ease: EASE, delay: delay + LINE_MS / 1000 }}
        >
          <StatusSquare status={status} dark={dark} />
        </motion.span>
        {auto && <span className="t-label">{t.status.auto}</span>}
        {isNew && <span className="t-label">{t.status.new}</span>}
      </span>
      <span className="flex min-w-0 items-start justify-between gap-4">
        <motion.span
          className={`min-w-0 t-body-lg ${voided ? STRIKE : ''}`}
          initial={animate ? { clipPath: 'inset(0 100% 0 0)' } : false}
          animate={{ clipPath: 'inset(0 0% 0 0)' }}
          transition={{ duration: LINE_MS / 1000, ease: EASE, delay }}
        >
          <span>{children}</span>
        </motion.span>
        {right != null && (
          <motion.span
            className={`shrink-0 text-right ${voided ? STRIKE : ''}`}
            initial={animate ? { clipPath: 'inset(0 100% 0 0)' } : false}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={{ duration: LINE_MS / 1000, ease: EASE, delay }}
          >
            <span>{right}</span>
          </motion.span>
        )}
      </span>
    </>
  )
  // Fixed columns so every row aligns whatever the right column holds; main text and the
  // right-aligned amount share the second column. ≥900px: main starts at the 1/3 mark. Phones
  // are single-column (DESIGN.md §4), so the status column is just wide enough for AUTO/NEW.
  const grid = 'grid grid-cols-[88px_1fr] items-start gap-x-4 py-4 app:grid-cols-[1fr_2fr]'
  return (
    <Tag className="relative">
      <motion.span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-px origin-left ${dark ? 'bg-[var(--hairline-dark)]' : 'bg-ink'}`}
        initial={animate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ duration: LINE_MS / 1000, ease: EASE, delay }}
      />
      <div className={aside ? 'flex items-center gap-2' : undefined}>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            role={checked === undefined ? undefined : 'radio'}
            aria-checked={checked}
            className={`${grid} w-full min-h-12 text-left`}
          >
            {body}
          </button>
        ) : (
          <div className={`${grid} w-full`}>{body}</div>
        )}
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
    </Tag>
  )
}
