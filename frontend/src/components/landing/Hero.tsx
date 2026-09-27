import { motion, useScroll, useTransform } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { t } from '../../strings'
import { ButtonLink } from '../ui/Button'
import { PixelSquares } from '../ui/PixelSquares'
import { RibbedGlass } from '../ui/RibbedGlass'

const L = t.landing

/** 100vh --cyan hero on idle ribbed glass; PixelSquares in the lower part with 0.3x parallax, kept
 * clear of the blurb and CTA so ink squares never sit behind ink text (DECISIONS D-033). */
export function Hero() {
  const reduced = useReducedMotion()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, (v) => v * 0.3)
  return (
    <RibbedGlass intensity="idle" className="relative min-h-[100svh]">
      <section aria-labelledby="hero-title" className="relative z-20 flex min-h-[100svh] flex-col justify-between gutter-x pb-10 pt-28">
        <h1 id="hero-title" className="t-display">{L.hero[0]}<br />{L.hero[1]}</h1>
        <div className="grid items-end gap-6 app:grid-cols-3">
          <p className="t-body-lg app:col-span-2">{L.blurb[0]}<br />{L.blurb[1]}</p>
          <ButtonLink to="/signup" className="app:justify-self-end app:max-w-xs">{L.start}</ButtonLink>
        </div>
      </section>
      <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-44 z-0 h-[26%] app:bottom-32 app:h-[30%]" style={reduced ? undefined : { y }}>
        <PixelSquares pattern={1107} count={11} />
      </motion.div>
    </RibbedGlass>
  )
}
