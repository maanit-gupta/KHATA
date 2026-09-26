import { useId, type ReactNode } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type Intensity = 'idle' | 'live'

const RIPPLE: Record<Intensity, { dur: string; scale: number; values: string }> = {
  idle: { dur: '10s', scale: 14, values: '0.012 0.004;0.018 0.006;0.012 0.004' },
  live: { dur: '3s', scale: 30, values: '0.012 0.004;0.026 0.009;0.012 0.004' },
}

/**
 * "Fluted glass": dense vertical ribs over cyan (layered repeating-linear-gradients), bent by an
 * animated SVG feTurbulence → feDisplacementMap ripple. `live` ripples faster (while recording).
 * Reduced motion: static ribs, no filter.
 */
export function RibbedGlass({ intensity = 'idle', className = '', children }:
  { intensity?: Intensity; className?: string; children?: ReactNode }) {
  const reduced = useReducedMotion()
  const filterId = `ribs-${useId().replace(/:/g, '')}`
  const r = RIPPLE[intensity]
  return (
    <div className={`relative isolate overflow-hidden bg-cyan ${className}`} data-intensity={intensity}>
      {!reduced && (
        <svg aria-hidden width="0" height="0" className="absolute">
          <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence key={intensity} type="fractalNoise" baseFrequency={r.values.split(';')[0]} numOctaves={1} seed={7} result="noise">
              <animate attributeName="baseFrequency" dur={r.dur} values={r.values} repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={r.scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      <div
        aria-hidden
        className="absolute -inset-6 -z-10"
        style={{
          backgroundImage: [
            'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.55) 0 1px, transparent 1px 9px)',
            'repeating-linear-gradient(90deg, var(--cyan) 0 4px, var(--cyan-deep) 4px 7px, var(--cyan) 7px 9px)',
          ].join(','),
          filter: reduced ? undefined : `url(#${filterId})`,
        }}
      />
      {children}
    </div>
  )
}
