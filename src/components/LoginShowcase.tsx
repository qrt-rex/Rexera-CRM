import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { cx } from './ui'

/**
 * Login page left panel: a short introduction, the welcome video in a framed card with a restrained brand accent
 * (navy #2E3A8C, orange #F47B20), the main services, and a digital clock on India time.
 */
const media = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches
export function useMedia(q: string) {
  const [on, setOn] = useState(() => media(q))
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const f = () => setOn(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

// ------------------------------------------------------------------------------------------------ IST digital clock
const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

/** The current time, ticking on each new second. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 1000 - (Date.now() % 1000) + 5) }
    t = setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    return () => clearTimeout(t)
  }, [])
  return now
}

/** Digits in fixed-width cells (so the clock never jiggles as numbers change). */
function Digits({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cx('inline-flex', className)}>
      {[...text].map((ch, i) => ch === ':'
        ? <span key={i} className="anim-blink w-[0.38em] text-center opacity-80">:</span>
        : <span key={i} className="inline-block w-[0.8em] text-center">{ch}</span>)}
    </span>
  )
}

export function IstClock({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const now = useNow()
  const p = Object.fromEntries(IST_TIME.formatToParts(now).map((x) => [x.type, x.value]))
  const hh = (p.hour ?? '00').padStart(2, '0'), mm = p.minute ?? '00', ss = p.second ?? '00', ap = (p.dayPeriod ?? '').toUpperCase()
  const sm = size === 'sm'
  return (
    <div role="timer" aria-live="off" aria-label={`India Standard Time ${hh}:${mm} ${ap}`}
      className={cx('rounded-xl border border-white/10 bg-[#1b2363] shadow-[0_10px_30px_-12px_rgba(27,35,99,.6)]', sm ? 'px-3.5 py-2' : 'px-4 py-2.5', className)}>
      <div className="flex items-center justify-between gap-5 whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/55">
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-400" />India Standard Time</span>
        <span className="text-white/35">IST</span>
      </div>
      <div className={cx('font-digital font-semibold leading-none tracking-tight text-white', sm ? 'mt-1 text-[22px]' : 'mt-1.5 text-[30px]')}>
        <Digits text={`${hh}:${mm}`} />
        <Digits text={ss} className={cx('ml-1 align-top text-[#F4A12A]', sm ? 'text-[12px]' : 'text-[15px]')} />
        <span className={cx('ml-1.5 align-top font-sans font-bold text-white/70', sm ? 'text-[9px]' : 'text-[11px]')}>{ap}</span>
      </div>
      <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[10.5px] font-medium text-white/60">{IST_DATE.format(now)}</p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ video
/** Plays muted on a loop (browsers only autoplay silent video); the button turns the sound on. */
export function LoginVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const still = useMedia('(prefers-reduced-motion: reduce)') // people who turn motion off get a paused video with controls
  useEffect(() => {
    // React never writes the `muted` attribute, so the browser's silent-autoplay rule doesn't apply — mute and start it here
    const v = ref.current
    if (!v || still) return
    v.defaultMuted = true; v.muted = true
    v.play().catch(() => {})
  }, [still])
  const toggle = () => {
    const v = ref.current
    if (!v) return
    v.muted = !muted
    setMuted(!muted)
    if (v.paused) v.play().catch(() => {})
  }
  return (
    <div className={cx('relative overflow-hidden bg-black', className)}>
      <video ref={ref} src="/login-video.mp4" className="block aspect-video w-full object-cover" autoPlay={!still} muted loop playsInline preload="auto"
        controls={still} aria-label="Rexera welcome video" />
      {!still && (
        <button type="button" onClick={toggle} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} title={muted ? 'Sound on' : 'Sound off'}
          className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70">
          {muted ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ left panel
const SERVICES = ['Seed Fund', 'PMEGP', 'Startup India', 'CGTMSE', 'ISO 9001']

export function LoginShowcase() {
  return (
    <div className="mx-auto w-full max-w-[600px]">
      <p className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[#F47B20]">
        <span className="h-px w-8 bg-[#F47B20]" />Welcome to Rexera
      </p>
      <h2 className="mt-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-[#1b2363] xl:text-[34px]">
        Funding, grants and certifications —<br className="hidden xl:block" /> every client file in one place.
      </h2>
      <p className="mt-3 max-w-[520px] text-[14.5px] leading-relaxed text-[#5B6275]">
        From the first call to the final approval: leads, bookings, documents and payments for every team.
      </p>

      <div className="relative mt-7">
        {/* one restrained accent: an offset navy panel and an orange corner rule */}
        <div aria-hidden className="absolute -bottom-3 -right-3 left-6 top-6 rounded-2xl bg-[#2E3A8C]" />
        <div aria-hidden className="absolute -left-3 -top-3 h-20 w-20 rounded-tl-2xl border-l-[3px] border-t-[3px] border-[#F47B20]" />
        <LoginVideo className="relative rounded-2xl shadow-[0_24px_48px_-20px_rgba(27,35,99,.55)] ring-1 ring-black/10" />
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A90A2]">Services</span>
        {SERVICES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border border-[#E3E6EB] bg-white px-3 py-1 text-[12px] font-semibold text-[#2E3A8C]">
            <span className="size-1.5 rounded-full bg-[#F47B20]" />{s}
          </span>
        ))}
      </div>
    </div>
  )
}
