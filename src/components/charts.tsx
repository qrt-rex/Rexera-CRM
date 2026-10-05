import { useState, type ReactNode } from 'react'

export const SERIES = ['#2E3A8C', '#F47B20', '#0E9F6E', '#7C3AED', '#0891B2', '#DB2777', '#B45309', '#64748B']

/** Vertical bars with hover values. */
export function Bars({ data, height = 180, color = 'var(--brand)', format = (n: number) => String(n), highlightLast }: {
  data: { label: string; value: number; color?: string }[]; height?: number; color?: string; format?: (n: number) => string; highlightLast?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-1.5 sm:gap-2" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * (height - 34))
        const on = hover === i
        return (
          <div key={i} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className={`text-[10px] font-bold tabular-nums transition-opacity ${on ? 'opacity-100' : 'opacity-0 sm:group-hover:opacity-100'}`}>{format(d.value)}</span>
            <div className="w-full max-w-10 rounded-t-lg transition-all duration-700"
              style={{ height: h, background: d.color ?? (highlightLast && i === data.length - 1 ? 'var(--accent)' : color), opacity: hover === null || on ? 1 : 0.55 }} />
            <span className="w-full truncate text-center text-[10px] text-mute">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Donut with legend. */
export function Donut({ data, size = 150, label, format = (n: number) => String(n) }: { data: { label: string; value: number; color?: string }[]; size?: number; label?: string; format?: (n: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const [hover, setHover] = useState<number | null>(null)
  const r = 42, c = 2 * Math.PI * r
  let off = 0
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90 shrink-0" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * c
          const el = (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={d.color ?? SERIES[i % SERIES.length]} strokeWidth={hover === i ? 15 : 12}
              strokeDasharray={`${Math.max(0, len - 1)} ${c}`} strokeDashoffset={-off} className="transition-all duration-500"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          )
          off += len
          return el
        })}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" transform="rotate(90 50 50)" className="fill-[var(--ink)] text-[15px] font-extrabold">
          {hover !== null ? format(data[hover]!.value) : format(total)}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={i} className={`flex items-center gap-2 rounded-md px-1 ${hover === i ? 'bg-card2' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color ?? SERIES[i % SERIES.length] }} />
            <span className="min-w-0 flex-1 truncate text-mute">{d.label}</span>
            <span className="font-bold tabular-nums">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Ring({ value, size = 64, stroke = 8, color = 'var(--ok)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-extrabold">{children ?? `${Math.round(value)}%`}</div>
    </div>
  )
}

/** Smooth area sparkline. */
export function Spark({ values, height = 48, color = 'var(--brand)' }: { values: number[]; height?: number; color?: string }) {
  if (values.length < 2) return null
  const w = 200, max = Math.max(1, ...values), min = Math.min(0, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 4 - ((v - min) / (max - min || 1)) * (height - 8)] as const)
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const id = 'g' + Math.abs(values.reduce((a, b) => a * 31 + b, 7) | 0)
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w} ${height} L0 ${height}Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** Horizontal bars (funnel / ranking). */
export function HBars({ data, format = (n: number) => String(n) }: { data: { label: string; value: number; color?: string; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-semibold">{d.label}{d.sub && <span className="ml-1 font-normal text-mute">{d.sub}</span>}</span>
            <span className="font-bold tabular-nums">{format(d.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-card2">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? SERIES[i % SERIES.length] }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
