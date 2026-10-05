import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, type LucideIcon } from 'lucide-react'
import type { Tone } from '../lib/workflow'
import { initials } from '../lib/format'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ------------------------------------------------------------------ Button
type BtnVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'success' | 'soft'
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap active:scale-[.98]'
const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
  accent: 'bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/30',
  outline: 'border border-line bg-card text-ink hover:bg-card2',
  ghost: 'text-ink hover:bg-card2',
  danger: 'bg-bad text-white hover:opacity-90',
  success: 'bg-ok text-white hover:opacity-90',
  soft: 'bg-brand-soft text-brand-ink hover:brightness-95',
}
const btnSizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof btnSizes; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cx(btnBase, btnVariants[variant], btnSizes[size], className)}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, badge, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; badge?: number }) {
  return (
    <button aria-label={label} title={label} {...rest} className={cx('relative grid size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink transition-colors', className)}>
      <Icon className="size-5" />
      {!!badge && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 h-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-card">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

// ------------------------------------------------------------------ Form controls
export function Field({ label, required, hint, error, children, className }: { label?: string; required?: boolean; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-xs font-semibold text-mute">{label}{required && <span className="text-bad"> *</span>}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
    </label>
  )
}
const ctl = 'w-full rounded-xl border border-line bg-card px-3 text-sm text-ink placeholder:text-mute/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-60'
export function Input({ label, required, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return <Field label={label} required={required} hint={hint} error={error} className={className}><input required={required} {...rest} className={cx(ctl, 'h-10')} /></Field>
}
export function Select({ label, required, hint, error, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string; error?: string }) {
  return <Field label={label} required={required} hint={hint} error={error} className={className}><select required={required} {...rest} className={cx(ctl, 'h-10 pr-8')}>{children}</select></Field>
}
export function Textarea({ label, required, hint, error, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }) {
  return <Field label={label} required={required} hint={hint} error={error} className={className}><textarea required={required} rows={3} {...rest} className={cx(ctl, 'py-2.5 resize-y')} /></Field>
}
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="size-4 rounded accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}>
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

// ------------------------------------------------------------------ Surfaces
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-2xl border border-line bg-card shadow-card', className)}>{children}</div>
}
export function CardHeader({ title, subtitle, icon: Icon, action, className }: { title: ReactNode; subtitle?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 border-b border-line px-5 py-4', className)}>
      {Icon && <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand-ink"><Icon className="size-[18px]" /></span>}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-bold">{title}</h3>
        {subtitle && <p className="truncate text-xs text-mute">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

const toneCls: Record<Tone, string> = {
  navy: 'bg-brand-soft text-brand-ink',
  orange: 'bg-accent-soft text-accent',
  green: 'bg-ok-soft text-ok',
  red: 'bg-bad-soft text-bad',
  amber: 'bg-warn-soft text-warn',
  blue: 'bg-info-soft text-info',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  gray: 'bg-card2 text-mute border border-line',
  cyan: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
  pink: 'bg-pink-500/12 text-pink-600 dark:text-pink-300',
}
export const toneText: Record<Tone, string> = {
  navy: 'text-brand-ink', orange: 'text-accent', green: 'text-ok', red: 'text-bad', amber: 'text-warn', blue: 'text-info',
  violet: 'text-violet-600 dark:text-violet-300', gray: 'text-mute', cyan: 'text-cyan-700 dark:text-cyan-300', pink: 'text-pink-600 dark:text-pink-300',
}
export function Badge({ tone = 'gray', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', toneCls[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Avatar({ name, photo, size = 36, color }: { name: string; photo?: string; size?: number; color?: string }) {
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360
  return photo ? (
    <img src={photo} alt={name} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover ring-2 ring-card" />
  ) : (
    <span style={{ width: size, height: size, background: color ?? `hsl(${hue} 55% 46%)`, fontSize: size * 0.38 }}
      className="grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-card">{initials(name)}</span>
  )
}

export function Progress({ value, tone = 'navy', className }: { value: number; tone?: 'navy' | 'orange' | 'green' | 'red'; className?: string }) {
  const c = { navy: 'bg-brand', orange: 'bg-accent', green: 'bg-ok', red: 'bg-bad' }[tone]
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-card2 border border-line/60', className)}>
      <div className={cx('h-full rounded-full transition-all duration-700', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-ink"><Icon className="size-7" /></span>
      <h4 className="font-bold">{title}</h4>
      {text && <p className="mt-1 max-w-sm text-sm text-mute">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('relative overflow-hidden rounded-lg bg-card2', className)}><div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5" /></div>
}

export function PageHeader({ title, subtitle, icon: Icon, actions }: { title: string; subtitle?: string; icon?: LucideIcon; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 anim-fade-up">
      {Icon && <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-[#4b5bc4] text-white shadow-lg shadow-brand/25"><Icon className="size-6" /></span>}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, icon: Icon, tone = 'navy', sub, trend }: { label: string; value: ReactNode; icon: LucideIcon; tone?: Tone; sub?: ReactNode; trend?: number }) {
  return (
    <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start gap-3">
        <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl', toneCls[tone])}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-mute">{label}</p>
          <p className="mt-0.5 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-mute">
            {trend !== undefined && <span className={cx('font-bold', trend >= 0 ? 'text-ok' : 'text-bad')}>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%</span>}
            {sub}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ Tabs
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: string; count?: number; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto rounded-xl border border-line bg-card2 p-1', className)}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition',
            value === t.id ? 'bg-card text-ink shadow-sm' : 'text-mute hover:text-ink')}>
          {t.icon && <t.icon className="size-4" />}
          {t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-[11px]', value === t.id ? 'bg-brand text-white' : 'bg-line text-mute')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Modal & Drawer
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', on); document.body.style.overflow = prev }
  }, [open, onClose])
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEscape(open, onClose)
  const id = useId()
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0b1020]/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={cx('anim-pop flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-line bg-card shadow-pop sm:rounded-3xl', w)}>
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={id} className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-mute">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-[#0b1020]/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className={cx('anim-slide flex h-full w-full flex-col border-l border-line bg-card shadow-pop', width)}>
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-bold">{title}</h2>{subtitle && <div className="text-sm text-mute">{subtitle}</div>}</div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------ Dropdown menu
export function Menu({ trigger, children, align = 'right', width = 'w-64' }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', on)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div role="menu" className={cx('anim-pop absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-card shadow-pop', width, align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
export function MenuItem({ icon: Icon, children, onClick, danger }: { icon?: LucideIcon; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-card2', danger ? 'text-bad' : 'text-ink')}>
      {Icon && <Icon className="size-4 opacity-70" />}{children}
    </button>
  )
}

// ------------------------------------------------------------------ Toasts
type ToastT = { id: number; tone: 'success' | 'error' | 'info' | 'warning'; text: string }
const ToastCtx = createContext<(tone: ToastT['tone'], text: string) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([])
  const push = useCallback((tone: ToastT['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-3), { id, tone, text }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 5500 : 3500)
  }, [])
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
  const tones = { success: 'text-ok', error: 'text-bad', info: 'text-info', warning: 'text-warn' }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
          {items.map((t) => { const I = icons[t.tone]; return (
            <div key={t.id} className="anim-pop pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm shadow-pop">
              <I className={cx('mt-0.5 size-5 shrink-0', tones[t.tone])} /><span className="font-medium">{t.text}</span>
            </div>) })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/** Run an action; show its error as a toast, or a success message. Returns true on success. */
export function useRun() {
  const toast = useToast()
  return useCallback(async <T,>(fn: () => T | Promise<T>, ok?: string): Promise<Exclude<T, void> | true | undefined> => {
    try {
      const r = await fn()
      if (ok) toast('success', ok)
      return (r ?? true) as Exclude<T, void> | true
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Something went wrong.')
      return undefined
    }
  }, [toast])
}

// ------------------------------------------------------------------ Confirm
export function useConfirm() {
  const [state, setState] = useState<{ title: string; text: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null)
  const confirm = useCallback((title: string, text: string, danger = false) => new Promise<boolean>((resolve) => setState({ title, text, danger, resolve })), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const node = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title} size="sm"
      footer={<><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>Confirm</Button></>}>
      <p className="text-sm text-mute">{state?.text}</p>
    </Modal>
  )
  return [confirm, node] as const
}

// ------------------------------------------------------------------ Table helpers
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-x-auto', className)}><table className="w-full min-w-[640px] text-sm">{children}</table></div>
}
export function Th({ children, className, onClick, sorted }: { children?: ReactNode; className?: string; onClick?: () => void; sorted?: 'asc' | 'desc' | false }) {
  return (
    <th onClick={onClick} className={cx('sticky top-0 border-b border-line bg-card2 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-mute', onClick && 'cursor-pointer select-none hover:text-ink', className)}>
      {children}{sorted ? (sorted === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx('border-b border-line/70 px-4 py-3 align-middle', className)}>{children}</td>
}

export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
    </div>
  )
}

export function FileButton({ accept, onFile, children, maxBytes = 5 * 1024 * 1024 }: { accept?: string; onFile: (f: File) => void; children: ReactNode; maxBytes?: number }) {
  const ref = useRef<HTMLInputElement>(null)
  const toast = useToast()
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        if (f.size > maxBytes) { toast('error', `File too large (max ${Math.round(maxBytes / 1024)} KB).`); return }
        onFile(f)
      }} />
      <span onClick={() => ref.current?.click()}>{children}</span>
    </>
  )
}

export function readAsDataUrl(f: File) {
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}
