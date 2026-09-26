import { ButtonLink } from '../components/ui/Button'
import { NavChip } from '../components/ui/Chip'
import { H2 } from '../components/ui/H2'
import { Header } from '../components/ui/Header'
import { Row } from '../components/ui/Row'
import { StatusSquare, type Status } from '../components/ui/StatusSquare'
import { t } from '../strings/en'

const a = t.about

/** Public /about: what Khata does and how an entry travels from voice or photo to the ledger. */
export function AboutScreen() {
  return (
    <div className="min-h-dvh bg-paper">
      <Header>
        <NavChip to="/signup">{a.navSignup}</NavChip>
        <NavChip to="/login">{a.navLogin}</NavChip>
      </Header>

      <section className="bg-cyan gutter-x pb-16 pt-28 app:pb-24 app:pt-36">
        <h1 className="t-display">{a.hero[0]}<br />{a.hero[1]}</h1>
        <p className="mt-8 max-w-2xl t-body-lg">{a.intro}</p>
      </section>

      <Section title={a.flowTitle} tone="paper">
        <ol className="grid gap-px bg-ink app:grid-cols-2">
          {a.flows.map((f) => (
            <li key={f.title} className="flex flex-col gap-4 bg-paper p-6 app:p-8">
              <p className="t-label">{f.label}</p>
              <h3 className="t-h3">{f.title}</h3>
              <ol className="flex flex-col gap-3">
                {f.steps.map((s, i) => (
                  <li key={s} className="flex gap-4 t-body-lg">
                    <span className="w-6 shrink-0 tabular-nums">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={a.rulesTitle} tone="mist" lead={a.rulesLead}>
        <div className="border-b border-ink">
          {a.rules.map((r, i) => (
            <Row key={r.when} as="div" status={r.status as Status} index={i}
              right={<span className="t-label">{r.result}</span>}>
              <span className="t-body-lg">{r.when}</span>
            </Row>
          ))}
        </div>
        <p className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 t-body">
          <span className="inline-flex items-center gap-2"><StatusSquare status="confirmed" /> {a.legend.saved}</span>
          <span className="inline-flex items-center gap-2"><StatusSquare status="pending" /> {a.legend.pending}</span>
          <span className="inline-flex items-center gap-2"><StatusSquare status="unselected" /> {a.legend.nothing}</span>
        </p>
      </Section>

      <Section title={a.trustTitle} tone="ink">
        <ul className="grid gap-8 app:grid-cols-2">
          {a.trust.map((p) => (
            <li key={p.title} className="flex flex-col gap-2 border-t border-[var(--hairline-dark)] pt-4">
              <h3 className="t-label-lg">{p.title}</h3>
              <p className="t-body-lg text-paper/80">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={a.langTitle} tone="paper" lead={a.langLead}>
        <div className="border-b border-ink">
          {a.examples.map((e, i) => (
            <Row key={e.lang} as="div" status="confirmed" index={i} right={<span className="t-label">{e.lang}</span>}>
              <span className="t-body-lg">{e.said}</span>
            </Row>
          ))}
        </div>
      </Section>

      <Section title={a.stackTitle} tone="mist">
        <dl className="grid gap-px bg-ink app:grid-cols-2">
          {a.stack.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-2 bg-mist p-6">
              <dt className="t-label">{k}</dt>
              <dd className="t-body-lg">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="grid gap-8 bg-cyan gutter-x py-16 app:grid-cols-3 app:py-24">
        <H2 lines={a.ctaTitle} />
        <div className="flex flex-col gap-4 app:col-span-2">
          <p className="t-body-lg">{a.ctaBody}</p>
          <ButtonLink to="/signup">{a.ctaSignup}</ButtonLink>
          <a href={a.repoUrl} className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">
            {a.repo}
          </a>
        </div>
      </section>
    </div>
  )
}

function Section({ title, tone, lead, children }:
  { title: readonly string[]; tone: 'paper' | 'mist' | 'ink'; lead?: string; children: React.ReactNode }) {
  const bg = { paper: 'bg-paper text-ink', mist: 'bg-mist text-ink', ink: 'bg-ink text-paper' }[tone]
  return (
    <section className={`grid gap-8 gutter-x py-16 app:grid-cols-3 app:py-24 ${bg}`}>
      <div className="flex flex-col gap-4">
        <H2 lines={title} />
        {lead && <p className="t-body-lg">{lead}</p>}
      </div>
      <div className="app:col-span-2">{children}</div>
    </section>
  )
}
