import { t } from '../../strings/en'
import { RibbedGlass } from '../ui/RibbedGlass'
import { RevealHeading, Rise, useSectionReveal } from './reveal'

const L = t.landing

/** --mist: "Three ways / to keep the book." Three cards: a ribbed top panel, an H3, a 2-line body. */
export function HowItWorks() {
  const { ref, revealed } = useSectionReveal('how')
  return (
    <section id="how-it-works" ref={ref} aria-labelledby="how-title" className="scroll-mt-14 bg-mist gutter-x py-20 app:py-32">
      <Rise revealed={revealed} className="grid gap-12 app:grid-cols-3">
        <RevealHeading id="how-title" lines={L.howTitle} revealed={revealed} />
        <ul className="grid gap-px bg-ink app:col-span-2 app:grid-cols-3">
          {L.ways.map((w) => (
            <li key={w.title} className="flex flex-col bg-paper">
              <RibbedGlass intensity="idle" className="h-32" />
              <div className="flex flex-col gap-3 p-6">
                <h3 className="t-h3">{w.title}</h3>
                <p className="t-body-lg">{w.body[0]}<br />{w.body[1]}</p>
              </div>
            </li>
          ))}
        </ul>
      </Rise>
    </section>
  )
}
