import { t } from '../../strings/en'
import { RevealHeading, Rise } from './reveal'
import { useSectionReveal } from '../../hooks/useSectionReveal'

const L = t.landing

/** Optional (DESIGN.md §7): rendered only when public/founder.jpg exists at build time. */
export function BuiltBy() {
  const { ref, revealed } = useSectionReveal('built-by')
  if (!__HAS_FOUNDER__) return null
  return (
    <section ref={ref} aria-labelledby="built-title" className="bg-paper gutter-x py-20 app:py-32">
      <Rise revealed={revealed} className="grid gap-12 app:grid-cols-3">
        <RevealHeading id="built-title" lines={L.builtByTitle} revealed={revealed} />
        <div className="grid gap-6 app:col-span-2 app:grid-cols-2">
          <img src="/founder.jpg" alt={L.founderAlt} className="aspect-square w-full object-cover" />
          {L.builtByBio.length > 0 && (
            <p className="t-body-lg">{L.builtByBio.map((line, i) => <span key={i}>{line}<br /></span>)}</p>
          )}
        </div>
      </Rise>
    </section>
  )
}
