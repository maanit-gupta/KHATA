import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../lib/ledger'
import { t } from '../strings'
import { SegmentChip } from './ui/Chip'

/** GOAL_2.0 P6.6: what an expense was for. Optional; tapping the chosen chip again clears it
 * (no category = "Uncategorised" on the dashboard). */
export function CategoryChips({ value, onChange, dark = false }:
  { value: ExpenseCategory | null; onChange: (v: ExpenseCategory | null) => void; dark?: boolean }) {
  return (
    <fieldset data-testid="category-chips">
      <legend className="mb-2 t-field-label">{t.categories.title}</legend>
      <div className="flex flex-wrap gap-2">
        {EXPENSE_CATEGORIES.map((c) => (
          <SegmentChip key={c} dark={dark} selected={value === c} onClick={() => onChange(value === c ? null : c)}>
            {t.categories.names[c]}
          </SegmentChip>
        ))}
      </div>
    </fieldset>
  )
}
