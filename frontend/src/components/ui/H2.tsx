import type { ElementType } from 'react'

/** Screen/section title, always split over two lines (DESIGN.md §3). */
export function H2({ lines, as: Tag = 'h2', className = '' }:
  { lines: readonly [string, string] | readonly string[]; as?: ElementType; className?: string }) {
  return (
    <Tag className={`t-h2 ${className}`}>
      {lines[0]}
      {lines[1] !== undefined && <><br />{lines[1]}</>}
    </Tag>
  )
}
