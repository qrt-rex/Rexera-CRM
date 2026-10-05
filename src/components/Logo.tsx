import { cx } from './ui'

/** `fixed` keeps brand colours in dark mode (for surfaces that are always light). */
export function Mark({ className, fixed }: { className?: string; fixed?: boolean }) {
  return (
    <svg viewBox="0 0 100 95" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="rx-navy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0B3A7E" /><stop offset="1" stopColor="#0A2457" /></linearGradient>
        <linearGradient id="rx-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F4A12A" /><stop offset="1" stopColor="#D9761C" /></linearGradient>
      </defs>
      <path d="M1.8 .7H64C80 .7 91 13 91 29S80 54 64 54H48.2L77 93.6H59L17 39H64C69 39 73 34.5 73 29S69 18.6 64 18.6H17Z" fill="url(#rx-navy)" className={fixed ? '' : 'dark:[fill:#c7d2fe]'} />
      <path d="M54.3 57.1H71.4L99 93.6H81.4Z" fill="url(#rx-gold)" />
    </svg>
  )
}

export function Logo({ className, size = 'md', fixed }: { className?: string; size?: 'sm' | 'md' | 'lg'; fixed?: boolean }) {
  const s = { sm: ['h-7', 'text-sm'], md: ['h-9', 'text-lg'], lg: ['h-14', 'text-3xl'] }[size]
  const navy = fixed ? 'text-[#0B3A7E]' : 'text-[#0B3A7E] dark:text-[#c7d2fe]'
  return (
    <span className={cx('inline-flex items-end gap-1 select-none', className)} aria-label="Rexera">
      <Mark className={cx(s[0], 'w-auto shrink-0')} fixed={fixed} />
      <span className={cx('pb-0.5 font-semibold tracking-[0.32em]', s[1])}>
        <span className={navy}>RE</span><span className="text-[#E8902A]">X</span><span className={navy}>E</span><span className="text-[#E8902A]">RA</span>
      </span>
    </span>
  )
}
