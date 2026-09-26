// Dev-only component gallery (/dev/ui). Loaded behind import.meta.env.DEV, so it is dropped
// from production builds. Specimen copy lives here, not in strings/en.ts, because users never see it.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button, ButtonLink } from '../components/ui/Button'
import { ChipButton, CountBadge, SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { Header } from '../components/ui/Header'
import { H2 } from '../components/ui/H2'
import { PixelSquares } from '../components/ui/PixelSquares'
import { RibbedGlass } from '../components/ui/RibbedGlass'
import { Row } from '../components/ui/Row'
import { StatusSquare } from '../components/ui/StatusSquare'
import { Toast, ToastAction } from '../components/ui/Toast'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { resetReveals, useReveal } from '../hooks/useReveal'
import { formatPaise } from '../lib/money'
import { LANG_ORDER, t } from '../strings/en'

const TOKENS = [
  ['--ink', 'bg-ink', true], ['--ink-soft', 'bg-ink-soft', true], ['--cyan', 'bg-cyan', false],
  ['--cyan-deep', 'bg-cyan-deep', false], ['--mist', 'bg-mist', false], ['--paper', 'bg-paper', false],
  ['--bone', 'bg-bone', false], ['--muted', 'bg-muted', false],
] as const

function Section({ id, title, children, dark = false, tone = '' }:
  { id: string; title: string; children: ReactNode; dark?: boolean; tone?: string }) {
  return (
    <section id={id} className={`${dark ? 'on-dark bg-ink text-paper' : tone} gutter-x py-12`}>
      <p className={`mb-6 t-label ${dark ? '' : 'text-muted'}`}>{title}</p>
      {children}
    </section>
  )
}

function Rows() {
  const [run, setRun] = useState(0)
  return (
    <div key={run}>
      <RowsInner run={run} />
      <Button variant="outline" className="mt-6 max-w-sm" onClick={() => { resetReveals(); setRun((r) => r + 1) }}>
        Replay line draw
      </Button>
    </div>
  )
}

function RowsInner({ run }: { run: number }) {
  const { animate } = useReveal({ key: `dev-rows-${run}` })
  return (
    <div className="border-b border-ink">
      <Row index={0} animate={animate} status="confirmed" right={<span className="t-amount">{formatPaise(25000)}</span>}>Ramesh · credit given</Row>
      <Row index={1} animate={animate} status="confirmed" auto right={<span className="t-amount">{formatPaise(125050)}</span>}>Lakshmi · payment received</Row>
      <Row index={2} animate={animate} status="pending" right={<span className="t-amount">{formatPaise(600000)}</span>}>Amount above ₹5,000</Row>
      <Row index={3} animate={animate} status="voided" right={<span className="t-amount">{formatPaise(9900)}</span>}>Suresh · voided entry</Row>
      <Row index={4} animate={animate} status="confirmed" isNew right="OWES YOU ₹2,300" onClick={() => undefined}>முருகன் (tappable)</Row>
      <Row index={5} animate={animate} status="confirmed" right={<span className="t-amount">{formatPaise(12500000)}</span>}>राम किराना · one lakh twenty-five thousand</Row>
    </div>
  )
}

function ToastSpecimen() {
  const [state, setState] = useState<'saved' | 'undone'>('saved')
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-col gap-4">
      <Toast inline>Hold the button while speaking.</Toast>
      {state === 'saved' ? (
        <Toast inline key={run} countdownMs={5000} action={<ToastAction onClick={() => setState('undone')}>{t.toast.undo}</ToastAction>}>
          SAVED · RAMESH · {formatPaise(25000)}
        </Toast>
      ) : (
        <Toast inline>{t.toast.undone}</Toast>
      )}
      <Button variant="outline" className="max-w-sm" onClick={() => { setState('saved'); setRun((r) => r + 1) }}>
        Restart 5s undo countdown
      </Button>
    </div>
  )
}

export default function DevUI() {
  const reduced = useReducedMotion()
  const [intensity, setIntensity] = useState<'idle' | 'live'>('idle')
  const [segment, setSegment] = useState('supplier')
  return (
    <div className="bg-paper pb-24">
      <Header home="/dev/ui">
        <ChipButton active>Dev UI</ChipButton>
      </Header>
      <div className="pt-14">
        <Section id="tokens" title="Tokens · DESIGN.md §2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {TOKENS.map(([name, cls, dark]) => (
              <div key={name} className="flex flex-col gap-2">
                <div className={`h-16 ${cls} ${dark ? '' : 'border border-ink'}`} />
                <span className="t-label">{name}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 t-body">Reduced motion: <span className="t-label">{reduced ? 'ON' : 'OFF'}</span></p>
        </Section>

        <Section id="type" title="Typography · §3" tone="bg-bone">
          <p className="t-display">Your khata,<br />by voice.</p>
          <H2 className="mt-10" lines={['Customers', 'and suppliers.']} />
          <p className="mt-8 t-h3">H3 · Ramesh Traders</p>
          <p className="mt-6 t-amount">{formatPaise(125000)} · {formatPaise(123456789)} · {formatPaise(25050)}</p>
          <p className="mt-6 t-body max-w-xl">Body 15px. Party names in six scripts: {LANG_ORDER.map((l) => t.languages[l]).join(' · ')}</p>
          <p className="mt-4 t-label">Label / nav / button · uppercase Latin · தமிழ் stays as is</p>
        </Section>

        <Section id="header" title="Header · §5 (desktop chips shown un-collapsed; scrolls on phones)">
          <div className="flex flex-col gap-4 overflow-x-auto">
            <Header fixed={false} home="/dev/ui">
              <ChipButton active>Ledger</ChipButton>
              <ChipButton>Parties</ChipButton>
              <span className="inline-flex items-center"><ChipButton>Review</ChipButton><CountBadge count={3} label="3 to review" /></span>
              <ChipButton>Settings</ChipButton>
            </Header>
            <Header fixed={false} home="/dev/ui"><ChipButton>{t.nav.menu}</ChipButton><CountBadge count={3} label="3 to review" /></Header>
            <RibbedGlass className="h-40">
              <Header fixed={false} tone="transparent" home="/dev/ui">
                <ChipButton>Home</ChipButton><ChipButton>Log in</ChipButton><ChipButton active>Get started</ChipButton>
              </Header>
            </RibbedGlass>
          </div>
        </Section>

        <Section id="chips-dark" title="Nav chips over a dark section (mix-blend-mode: difference)" dark>
          <div className="flex flex-wrap gap-2"><ChipButton blend>Home</ChipButton><ChipButton blend active>How it works</ChipButton></div>
        </Section>

        <Section id="chips" title="Segment chips · light and dark">
          <div className="grid max-w-xl grid-cols-3 gap-2">
            {['supplier', 'customer', 'expense'].map((k) => (
              <SegmentChip key={k} selected={segment === k} onClick={() => setSegment(k)}>{k}</SegmentChip>
            ))}
          </div>
          <div className="on-dark mt-6 grid max-w-xl grid-cols-2 gap-2 bg-ink p-6">
            <SegmentChip dark selected>{t.onboarding.create}</SegmentChip>
            <SegmentChip dark selected={false}>{t.onboarding.join}</SegmentChip>
          </div>
        </Section>

        <Section id="buttons" title="Buttons · primary / outline / text / disabled">
          <div className="flex max-w-md flex-col gap-4">
            <Button>Scan a bill</Button>
            <Button variant="outline">Edit</Button>
            <ButtonLink to="/dev/ui/transition">Page transition specimen</ButtonLink>
            <Button disabled>Working…</Button>
            <Button variant="text" className="self-start">Void entry</Button>
          </div>
        </Section>

        <Section id="buttons-dark" title="Inverse button + fields on the dark panel" dark>
          <div className="flex max-w-md flex-col gap-8">
            <Field dark label="Email" required placeholder="name@example.com" />
            <Field dark label="Password" required type="password" error="That email and password don’t match. Check both and try again." />
            <Button variant="inverse">Log in</Button>
          </div>
        </Section>

        <Section id="fields" title="Fields · light">
          <div className="flex max-w-md flex-col gap-8">
            <Field label="Vendor" defaultValue="Sri Murugan Traders" />
            <Field label="Total" required inputMode="decimal" defaultValue="1250" />
            <Field label="Customer name" required error="This field is required." />
          </div>
        </Section>

        <Section id="rows" title="Rows + status squares · §5 (line draw runs once per key)">
          <div className="mb-6 flex flex-wrap items-center gap-6">
            {(['confirmed', 'pending', 'voided', 'selected', 'unselected'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-2 t-label"><StatusSquare status={s} />{s}</span>
            ))}
          </div>
          <Rows />
        </Section>

        <Section id="rows-dark" title="Rows on dark (language picker)" dark>
          <div className="border-b border-[var(--hairline-dark)]">
            {LANG_ORDER.slice(0, 3).map((l, i) => (
              <Row key={l} dark status={i === 1 ? 'selected' : 'unselected'} checked={i === 1} onClick={() => undefined}>
                <span lang={l} className="t-h3">{t.languages[l]}</span>
              </Row>
            ))}
          </div>
        </Section>

        <Section id="squares" title="PixelSquares · same pattern number → same pattern">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative h-56 border border-ink"><PixelSquares pattern={7} /></div>
            <div className="relative h-56 border border-ink"><PixelSquares pattern={7} /></div>
            <div className="relative h-56 bg-ink"><PixelSquares pattern={42} count={12} dark /></div>
          </div>
        </Section>

        <Section id="glass" title={`RibbedGlass · ${intensity}${reduced ? ' (reduced motion: static ribs)' : ''}`}>
          <RibbedGlass intensity={intensity} className="flex h-[38vh] min-h-64 flex-col justify-end gap-3 p-4">
            <Button>{intensity === 'live' ? 'Listening… release to send' : 'Hold to add'}</Button>
            <Button variant="outline">Hold to ask</Button>
          </RibbedGlass>
          <div className="mt-4 grid max-w-md grid-cols-2 gap-2">
            <SegmentChip selected={intensity === 'idle'} onClick={() => setIntensity('idle')}>Idle</SegmentChip>
            <SegmentChip selected={intensity === 'live'} onClick={() => setIntensity('live')}>Live</SegmentChip>
          </div>
        </Section>

        <Section id="toast" title="Toast · §5, §6.5 (countdown hairline is linear, kept under reduced motion)">
          <ToastSpecimen />
        </Section>
      </div>
    </div>
  )
}

export function DevTransitionTarget() {
  return (
    <div className="flex min-h-dvh flex-col justify-center gap-8 bg-mist gutter-x">
      <H2 lines={['Page', 'transition.']} />
      <Link to="/dev/ui" className="t-label underline underline-offset-4">Back to /dev/ui</Link>
    </div>
  )
}
