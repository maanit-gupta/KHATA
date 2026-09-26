import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mulberry32 } from '../../lib/seeded'

const SIZE = 40

type Point = { x: number; y: number } // seeded {x%, y%}, 0–1
type Cell = { c: number; r: number }

/** Seeded {x%, y%} anchors, plus which anchors get a diagonal partner. Stable per seed. */
function seededPoints(seed: number, count: number): { points: Point[]; paired: boolean[]; dir: number[] } {
  const rand = mulberry32(seed)
  const points: Point[] = []
  const paired: boolean[] = []
  const dir: number[] = []
  for (let i = 0; i < count * 3; i++) {
    points.push({ x: rand(), y: rand() })
    paired.push(rand() < 0.35)
    dir.push(rand() < 0.5 ? 1 : -1)
  }
  return { points, paired, dir }
}

/**
 * Snap the seeded points onto the 40px cell grid of the container. Squares never touch side by
 * side or overlap; the only contact is a deliberate diagonal pair meeting corner-to-corner.
 */
function layoutCells(seed: number, count: number, cols: number, rows: number): Cell[] {
  if (cols < 2 || rows < 2) return []
  const { points, paired, dir } = seededPoints(seed, count)
  const taken = new Set<string>()
  const key = (c: number, r: number) => `${c},${r}`
  const sideBlocked = (c: number, r: number, ignore?: Cell) =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
      const n = { c: c + dc, r: r + dr }
      if (ignore && n.c === ignore.c && n.r === ignore.r) return false
      return taken.has(key(n.c, n.r))
    })
  const cells: Cell[] = []
  for (let i = 0; i < points.length && cells.length < count; i++) {
    const c = Math.min(cols - 1, Math.floor(points[i].x * cols))
    const r = Math.min(rows - 2, Math.floor(points[i].y * (rows - 1)))
    if (sideBlocked(c, r)) continue
    taken.add(key(c, r))
    cells.push({ c, r })
    if (paired[i] && cells.length < count) {
      const p = { c: c + dir[i], r: r + 1 }
      if (p.c >= 0 && p.c < cols && p.r < rows && !sideBlocked(p.c, p.r, { c, r })) {
        taken.add(key(p.c, p.r))
        cells.push(p)
      }
    }
  }
  return cells
}

/**
 * 40×40 solid squares in a seeded, asymmetric constellation (DESIGN.md §5). Ink on light,
 * --ink-soft on dark. Same seed + same size → same pattern. Decorative: aria-hidden.
 */
export function PixelSquares({ seed, count = 9, dark = false, className = '' }:
  { seed: number; count?: number; dark?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [grid, setGrid] = useState({ cols: 0, rows: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cols = Math.floor(el.clientWidth / SIZE)
      const rows = Math.floor(el.clientHeight / SIZE)
      setGrid((g) => (g.cols === cols && g.rows === rows ? g : { cols, rows }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cells = useMemo(() => layoutCells(seed, count, grid.cols, grid.rows), [seed, count, grid.cols, grid.rows])
  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {cells.map((cell, i) => (
        <span
          key={i}
          className={`absolute size-10 ${dark ? 'bg-ink-soft' : 'bg-ink'}`}
          style={{ left: cell.c * SIZE, top: cell.r * SIZE }}
        />
      ))}
    </div>
  )
}
