import { useId, type InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
  dark?: boolean
  /** Helper line under the field. tone "check" marks it with the pending square (look at this). */
  hint?: string | null
  hintTone?: 'info' | 'check'
}

/**
 * Underline-only input: 12px label above, `*` when required, no boxes. On error the underline
 * turns ink (white on dark) at 2px and a body-size error line appears below (DESIGN.md §5).
 */
export function Field({ label, error, dark = false, hint, hintTone = 'info', required, className = '', id, ...rest }: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const line = error
    ? dark ? 'border-b-2 border-paper' : 'border-b-2 border-ink'
    : dark ? 'border-b border-[var(--hairline-dark)] focus:border-paper' : 'border-b border-ink'
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={inputId} className="t-field-label">
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`min-h-12 w-full py-2 t-body-lg outline-offset-4 ${line} ${dark ? 'text-paper placeholder:text-[var(--hairline-dark)]' : 'text-ink'}`}
        {...rest}
      />
      {error && (
        <p id={errorId} className="t-body" role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={hintId} className="flex items-start gap-2 t-body" data-hint={hintTone}>
          {hintTone === 'check' && <span aria-hidden className="mt-[5px] inline-block size-[10px] shrink-0 bg-cyan-deep" />}
          {hint}
        </p>
      )}
    </div>
  )
}
