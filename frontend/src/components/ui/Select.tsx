import { useId, type SelectHTMLAttributes } from 'react'

/** A native select in the Field style: 12px label above, underline only, no chevron icon (DESIGN.md
 * §1: squares are the only markers). Native, so phones show their own picker. */
export function Select({ label, options, className = '', id, ...rest }:
  SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={selectId} className="t-field-label">{label}</label>
      <div className="relative">
        <select id={selectId} className="min-h-12 w-full appearance-none border-b border-ink bg-transparent py-2 pr-6 t-body-lg text-ink" {...rest}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 size-[8px] -translate-y-1/2 bg-ink" />
      </div>
    </div>
  )
}
