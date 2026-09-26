import { t } from '../../strings/en'
import { Row } from '../ui/Row'
import { RevealHeading, Rise } from './reveal'
import { useSectionReveal } from '../../hooks/useSectionReveal'

const L = t.landing

/** --cyan: real example commands. Square | the phrase in its own script | LANGUAGE. Replaces
 * testimonials (DESIGN.md §7). */
export function SayItYourWay() {
  const { ref, revealed, animate } = useSectionReveal('say')
  return (
    <section ref={ref} aria-labelledby="say-title" className="bg-cyan gutter-x py-20 app:py-32">
      <Rise revealed={revealed} className="grid gap-12 app:grid-cols-3">
        <RevealHeading id="say-title" lines={L.sayTitle} revealed={revealed} />
        <div key={String(revealed)} className={`border-b border-ink app:col-span-2 ${revealed ? '' : 'invisible'}`}>
          {L.sayLines.map((l, i) => (
            <Row key={l.code} as="div" index={i} animate={animate && revealed} status="confirmed"
              right={<span className="t-label">{l.lang}</span>}>
              <span lang={l.code} className="t-body-lg">{l.said}</span>
            </Row>
          ))}
        </div>
      </Rise>
    </section>
  )
}
