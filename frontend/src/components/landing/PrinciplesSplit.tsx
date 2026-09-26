import { t } from '../../strings/en'
import { PixelSquares } from '../ui/PixelSquares'
import { Row } from '../ui/Row'
import { RevealHeading } from './reveal'
import { useSectionReveal } from '../../hooks/useSectionReveal'

const L = t.landing

/** Ink 1/3 with the white H2 + cyan 2/3 with three feature rows. The cyan panel slides in from
 * the right; rows line-draw, wipe and pop (DESIGN.md §8). */
export function PrinciplesSplit() {
  const { ref, revealed, animate } = useSectionReveal('principles')
  return (
    <section ref={ref} aria-labelledby="trust-title" data-dark className="grid overflow-hidden app:grid-cols-3">
      <div className="on-dark relative min-h-[260px] bg-ink gutter-x py-20 text-paper app:py-32">
        <RevealHeading id="trust-title" lines={L.trustTitle} revealed={revealed} dark />
        <PixelSquares seed={907} count={4} dark className="top-1/2" />
      </div>
      <div className={`motion-ui bg-cyan gutter-x py-20 transition-transform duration-700 ease-brand app:col-span-2 app:py-32 ${revealed ? 'translate-x-0' : 'translate-x-full'}`}>
        <div key={String(revealed)} className={`border-b border-ink ${revealed ? '' : 'invisible'}`}>
          {L.principles.map((p, i) => (
            <Row key={p} as="div" index={i} animate={animate && revealed} status="confirmed">
              <span className="t-h3">{p}</span>
            </Row>
          ))}
        </div>
      </div>
    </section>
  )
}
