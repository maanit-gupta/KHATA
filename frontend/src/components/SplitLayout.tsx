import type { ReactNode } from 'react'
import { Header } from './ui/Header'
import { H2 } from './ui/H2'

/**
 * DESIGN.md §6.1/§6.2, after the brief's CONTACT split: a --cyan top band (two-line H2 left,
 * blurb right-aligned); below it the left 1/3 stays cyan with a small label bottom-left and the
 * right 2/3 is the --ink form panel. Mobile stacks band → panel.
 */
export function SplitLayout({ heading, blurb, label, children }:
  { heading: readonly string[]; blurb?: readonly string[]; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cyan">
      <Header />
      <section className="grid gap-6 gutter-x pt-[calc(var(--header-h)+48px)] pb-12 app:grid-cols-3 app:pb-16">
        <H2 lines={heading} as="h1" className="app:col-span-1" />
        {blurb && (
          <p className="t-body-lg app:col-span-2 app:self-end app:text-right">
            {blurb[0]}
            <br />
            {blurb[1]}
          </p>
        )}
      </section>
      <div className="grid flex-1 app:grid-cols-3">
        <div className="hidden items-end gutter-x pb-8 app:flex">
          <p className="t-label">{label}</p>
        </div>
        <section className="on-dark bg-ink text-paper gutter-x py-10 app:col-span-2 app:px-[56px] app:py-16">
          <div className="max-w-[560px]">{children}</div>
        </section>
      </div>
    </div>
  )
}
