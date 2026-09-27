import { useEffect, useState } from 'react'
import { BuiltBy } from '../components/landing/BuiltBy'
import { Footer } from '../components/landing/Footer'
import { Hero } from '../components/landing/Hero'
import { HowItWorks } from '../components/landing/HowItWorks'
import { PrinciplesSplit } from '../components/landing/PrinciplesSplit'
import { SayItYourWay } from '../components/landing/SayItYourWay'
import { ChipButton, NavChip } from '../components/ui/Chip'
import { Header } from '../components/ui/Header'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { t } from '../strings'

const L = t.landing

/** true while a [data-dark] section sits under the fixed header, so the chips switch to
 * mix-blend-mode: difference and stay readable (DESIGN.md §5). */
function useDarkUnderHeader() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      const el = document.elementsFromPoint(window.innerWidth / 2, 28).find((e) => !e.closest('header'))
      setDark(!!el?.closest('[data-dark]'))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])
  return dark
}

/** Public landing page at / (DESIGN.md §7). */
export default function LandingScreen() {
  const dark = useDarkUnderHeader()
  const reduced = useReducedMotion()
  const scrollTo = (top: number | string) => {
    const y = typeof top === 'number' ? top : (document.getElementById(top)?.offsetTop ?? 0) - 56
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' })
  }
  return (
    <div className="bg-paper">
      <Header tone="transparent">
        <div className="hidden items-center gap-2 app:flex">
          <ChipButton blend={dark} onClick={() => scrollTo(0)}>{L.nav.home}</ChipButton>
          <ChipButton blend={dark} onClick={() => scrollTo('how-it-works')}>{L.nav.how}</ChipButton>
        </div>
        <NavChip to="/login" blend={dark}>{L.nav.login}</NavChip>
        <NavChip to="/signup" blend={dark}>{L.nav.start}</NavChip>
      </Header>
      <main>
        <Hero />
        <HowItWorks />
        <PrinciplesSplit />
        <SayItYourWay />
        <BuiltBy />
      </main>
      <Footer />
    </div>
  )
}
