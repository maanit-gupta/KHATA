/**
 * GOAL_2.0 P8 mobile basics that need a little script.
 *
 * Keyboard: when a field gets focus and the on-screen keyboard has shrunk the visual viewport,
 * scroll the field into the middle of what is still visible, so a form is never hidden behind it.
 */
export function keepFocusedFieldVisible() {
  const vv = window.visualViewport
  if (!vv) return
  const onFocus = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null
    if (!el || !el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) return
    // The keyboard opens a moment after focus; check once it has.
    window.setTimeout(() => {
      if (vv.height < window.innerHeight * 0.85) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 300)
  }
  document.addEventListener('focusin', onFocus)
}
