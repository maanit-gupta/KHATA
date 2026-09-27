import { Link } from 'react-router'
import { t } from '../../strings'
import { PixelSquares } from '../ui/PixelSquares'

const L = t.landing

/** Ink footer: wordmark, stacked links, the "Built for" line, ghost squares, and the repo URL set
 * large and uppercase with a thick underline. */
export function Footer() {
  return (
    <footer data-dark className="on-dark relative overflow-hidden bg-ink gutter-x pb-12 pt-20 text-paper">
      <PixelSquares pattern={3301} count={8} dark />
      <div className="relative z-10 grid gap-12 app:grid-cols-3">
        <p className="t-h2">{t.brand}</p>
        <nav aria-label={t.landing.nav.home} className="app:col-span-2">
          <ul className="flex flex-col">
            {L.footerLinks.map((l) => (
              <li key={l.to} className="border-t border-[var(--hairline-dark)]">
                <Link to={l.to} className="flex min-h-12 items-center justify-between py-3 t-label-lg">
                  <span>{l.label}</span><span aria-hidden>{t.arrow}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="relative z-10 mt-16 flex flex-col gap-6">
        <p className="t-body">{L.builtFor}</p>
        <a href={L.repoUrl} className="break-all uppercase underline decoration-4 underline-offset-8 text-[clamp(22px,4.5vw,56px)] leading-[1.1] tracking-[-0.01em]">
          {L.repoLabel}
        </a>
      </div>
    </footer>
  )
}
