import { useId, type InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | null
  dark?: boolean
}

/**
 * Underline-only input: 12px label above, `*` when required, no boxes. On error the underline
 * turns ink (white on dark) at 2px and a body-size error line appears below (DESIGN.md §5).
 */
export function Field({ label, error, dark = false, required, className = '', id, ...rest }: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
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
        aria-describedby={error ? errorId : undefined}
        className={`min-h-12 w-full py-2 t-body-lg outline-offset-4 ${line} ${dark ? 'text-paper placeholder:text-[var(--hairline-dark)]' : 'text-ink'}`}
        {...rest}
      />
      {error && (
        <p id={errorId} className="t-body" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
