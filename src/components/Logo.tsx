import { cx } from './ui'

/**
 * Rexera brand artwork (public/brand): navy + gold for light backgrounds, cream + gold for dark mode.
 * `fixed` always uses the light-background version (for surfaces that stay white in dark mode: the login card,
 * invoices, payslips, printouts).
 */
const MARK = { light: '/brand/rexera-mark.png', dark: '/brand/rexera-mark-dark.png', w: 265, h: 256 }
const WORDMARK = { light: '/brand/rexera-wordmark.png', dark: '/brand/rexera-wordmark-dark.png', w: 946, h: 128 }

function Art({ art, className, fixed }: { art: typeof MARK; className?: string; fixed?: boolean }) {
  const img = (src: string, show: string) => (
    <img src={src} alt="" width={art.w} height={art.h} draggable={false} decoding="async" className={cx('w-auto shrink-0 select-none', show, className)} />
  )
  if (fixed) return img(art.light, 'inline-block')
  return <>{img(art.light, 'inline-block dark:hidden')}{img(art.dark, 'hidden dark:inline-block')}</>
}

/** The "R" mark on its own. */
export function Mark({ className, fixed }: { className?: string; fixed?: boolean }) {
  return <span aria-hidden="true" className="inline-flex"><Art art={MARK} className={className} fixed={fixed} /></span>
}

/** "R" mark + REXERA wordmark. `onDark` always uses the cream + gold version (for navy / photo backgrounds). */
export function Logo({ className, size = 'md', fixed, onDark }: { className?: string; size?: 'sm' | 'md' | 'lg'; fixed?: boolean; onDark?: boolean }) {
  const s = { sm: ['h-7', 'h-[12px]', 'gap-1.5'], md: ['h-9', 'h-[15px]', 'gap-2'], lg: ['h-14', 'h-6', 'gap-3'] }[size]
  const art = (a: typeof MARK, c: string) => onDark
    ? <img src={a.dark} alt="" width={a.w} height={a.h} draggable={false} decoding="async" className={cx('inline-block w-auto shrink-0 select-none', c)} />
    : <Art art={a} className={c} fixed={fixed} />
  return (
    <span role="img" aria-label="Rexera" className={cx('inline-flex select-none items-end', s[2], className)}>
      {art(MARK, s[0])}
      {art(WORDMARK, cx(s[1], 'mb-px'))}
    </span>
  )
}
