import type { ReactNode } from 'react'
import { Globe } from 'lucide-react'
import { cx } from './ui'

/** Rexera's public pages (shown on the job application form). */
export const SOCIAL_LINKS = [
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/rexera.co.in' },
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/p/Rexera-financial-services-pvt-ltd-61580466097791/' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://in.linkedin.com/company/rexera-financial-services-private-limited' },
  { id: 'website', label: 'rexera.co.in', href: 'https://rexera.co.in' },
] as const

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0" aria-hidden="true">{children}</svg>
)
/** Simple line icons in the same style as the rest of the CRM (the icon library has no brand logos). */
const ICON: Record<(typeof SOCIAL_LINKS)[number]['id'], ReactNode> = {
  instagram: svg(<><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></>),
  facebook: svg(<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />),
  linkedin: svg(<><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></>),
  website: <Globe className="size-3.5 shrink-0" aria-hidden="true" />,
}

/** Small pill links (Instagram, Facebook, LinkedIn, website). `onDark` for navy headers. */
export function SocialLinks({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <nav aria-label="Rexera online" className={cx('flex flex-wrap gap-2', className)}>
      {SOCIAL_LINKS.map((l) => (
        <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer"
          className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition',
            onDark ? 'bg-white/12 text-white ring-1 ring-white/20 hover:bg-white/20' : 'bg-card2 text-ink ring-1 ring-line hover:bg-brand-soft')}>
          {ICON[l.id]}{l.label}
        </a>
      ))}
    </nav>
  )
}
