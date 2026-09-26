const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const fractional = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Integer paise → "₹1,250" (en-IN grouping, so 1,25,000 for a lakh). Paise shown only when non-zero. */
export function formatPaise(paise: number): string {
  const rupees = paise / 100
  return `₹${paise % 100 === 0 ? whole.format(rupees) : fractional.format(rupees)}`
}
