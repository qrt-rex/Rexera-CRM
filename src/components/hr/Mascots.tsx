import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../ui'

/**
 * Original Rexera mascots, drawn as SVG (no third-party characters):
 *   Rexy  – round blue robot with an orange antenna and "R" badge
 *   Bao   – panda
 *   Kabir – boy with curly hair and an orange T-shirt
 *   Meera – girl with hair buns and a pink top
 * Licensed artwork can replace any slot via /mascots/manifest.json, e.g. { "bao-wink": "bao-wink.png" }.
 */

const SKIN = '#F5C9A0'
const INK = '#1B2559'
const origin = (x: number, y: number): CSSProperties => ({ transformBox: 'view-box', transformOrigin: `${x}px ${y}px` })

// ------------------------------------------------------------------ manifest override
export type MascotSlot = 'rexy' | 'rexy-sign' | 'bao' | 'bao-wink' | 'bao-laptop' | 'kabir-peek' | 'kabir-laptop' | 'meera'
let manifestPromise: Promise<Partial<Record<MascotSlot, string>>> | null = null
function loadManifest() {
  manifestPromise ??= fetch('/mascots/manifest.json', { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return {}
      const raw = (await r.json()) as Record<string, unknown>
      const out: Partial<Record<MascotSlot, string>> = {}
      for (const [k, v] of Object.entries(raw)) {
        // only plain file names inside /mascots — no URLs, no paths outside the folder
        if (typeof v === 'string' && /^[\w.-]+\.(png|webp|svg|gif|jpe?g)$/i.test(v)) out[k as MascotSlot] = `/mascots/${v}`
      }
      return out
    })
    .catch(() => ({}))
  return manifestPromise
}
function useSlotImage(slot: MascotSlot) {
  const [src, setSrc] = useState<string | undefined>()
  useEffect(() => { let on = true; loadManifest().then((m) => on && setSrc(m[slot])); return () => { on = false } }, [slot])
  return src
}

/** Renders the licensed image for a slot when the manifest maps one, otherwise the SVG character. */
export function Mascot({ slot, className, label, children }: { slot: MascotSlot; className?: string; label: string; children: ReactNode }) {
  const src = useSlotImage(slot)
  return src
    ? <img src={src} alt={label} className={cx('object-contain', className)} draggable={false} />
    : <span role="img" aria-label={label} className={cx('block', className)}>{children}</span>
}

// ------------------------------------------------------------------ Rexy the robot
function RexyHead({ wink }: { wink?: boolean }) {
  return (
    <>
      <line x1="60" y1="26" x2="60" y2="12" stroke="#33408F" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="10" r="6" fill="#F47B20" className="m-twinkle" style={origin(60, 10)} />
      <rect x="12" y="46" width="10" height="18" rx="4" fill="#33408F" />
      <rect x="98" y="46" width="10" height="18" rx="4" fill="#33408F" />
      <rect x="20" y="24" width="80" height="62" rx="28" fill="#4F7DF3" />
      <rect x="30" y="34" width="60" height="42" rx="20" fill="#EAF1FF" />
      <g className="m-blink" style={origin(60, 53)}>
        <ellipse cx="47" cy="53" rx="5" ry="6.5" fill={INK} />
        {wink ? <path d="M68 54 Q73 49 78 54" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" /> : <ellipse cx="73" cy="53" rx="5" ry="6.5" fill={INK} />}
        <circle cx="49" cy="51" r="1.8" fill="#fff" />
        {!wink && <circle cx="75" cy="51" r="1.8" fill="#fff" />}
      </g>
      <circle cx="40" cy="64" r="4" fill="#FF9DB5" opacity=".75" />
      <circle cx="80" cy="64" r="4" fill="#FF9DB5" opacity=".75" />
      <path d="M52 64 Q60 71 68 64" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </>
  )
}
function RexyBody() {
  return (
    <>
      <rect x="42" y="126" width="12" height="16" rx="5" fill="#33408F" />
      <rect x="66" y="126" width="12" height="16" rx="5" fill="#33408F" />
      <rect x="34" y="86" width="52" height="44" rx="18" fill="#4F7DF3" />
      <rect x="42" y="93" width="36" height="29" rx="12" fill="#EAF1FF" />
      <circle cx="60" cy="107" r="10" fill="#F47B20" />
      <text x="60" y="111.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" fontFamily="Inter, sans-serif">R</text>
    </>
  )
}

export function Rexy({ pose = 'stand', className }: { pose?: 'stand' | 'wave' | 'sign' | 'peek'; className?: string }) {
  const slot: MascotSlot = pose === 'sign' ? 'rexy-sign' : 'rexy'
  if (pose === 'peek') {
    return (
      <Mascot slot="rexy" label="Rexy the robot peeking" className={className}>
        <svg viewBox="0 0 120 96" className="h-full w-full overflow-visible"><RexyHead wink /><circle cx="30" cy="90" r="8" fill="#4F7DF3" /><circle cx="90" cy="90" r="8" fill="#4F7DF3" /></svg>
      </Mascot>
    )
  }
  return (
    <Mascot slot={slot} label={pose === 'sign' ? 'Rexy holding a sign: Happy Team, Happy Company' : 'Rexy the robot'} className={className}>
      <svg viewBox="0 0 120 150" className="h-full w-full overflow-visible">
        <ellipse cx="60" cy="146" rx="30" ry="4" fill="#000" opacity=".08" />
        <g className="m-bob">
          <RexyHead />
          <RexyBody />
          {pose === 'sign' ? (
            <g>
              <rect x="6" y="84" width="108" height="42" rx="9" fill="#fff" stroke="#2E3A8C" strokeWidth="3" />
              <text x="60" y="101" textAnchor="middle" fontSize="11" fontWeight="800" fill="#2E3A8C" fontFamily="Inter, sans-serif">Happy Team</text>
              <text x="60" y="116" textAnchor="middle" fontSize="11" fontWeight="800" fill="#F47B20" fontFamily="Inter, sans-serif">Happy Company ♥</text>
              <circle cx="10" cy="105" r="6" fill="#4F7DF3" /><circle cx="110" cy="105" r="6" fill="#4F7DF3" />
            </g>
          ) : (
            <>
              <path d="M36 98 Q22 106 25 120" stroke="#4F7DF3" strokeWidth="9" strokeLinecap="round" fill="none" />
              {pose === 'wave' ? (
                <g className="m-wave" style={origin(84, 96)}>
                  <path d="M84 96 Q100 86 99 70" stroke="#4F7DF3" strokeWidth="9" strokeLinecap="round" fill="none" />
                  <circle cx="99" cy="66" r="6.5" fill="#4F7DF3" />
                </g>
              ) : <path d="M84 98 Q98 106 95 120" stroke="#4F7DF3" strokeWidth="9" strokeLinecap="round" fill="none" />}
            </>
          )}
        </g>
      </svg>
    </Mascot>
  )
}

// ------------------------------------------------------------------ Bao the panda
function BaoHead({ wink }: { wink?: boolean }) {
  return (
    <>
      <circle cx="30" cy="24" r="13" fill="#1F2333" />
      <circle cx="90" cy="24" r="13" fill="#1F2333" />
      <ellipse cx="60" cy="52" rx="40" ry="34" fill="#fff" stroke="#1F2333" strokeWidth="2.5" />
      <ellipse cx="44" cy="50" rx="10" ry="13" fill="#1F2333" transform="rotate(-25 44 50)" />
      <ellipse cx="76" cy="50" rx="10" ry="13" fill="#1F2333" transform="rotate(25 76 50)" />
      <g className="m-blink" style={origin(60, 50)}>
        <circle cx="45" cy="50" r="4" fill="#fff" /><circle cx="46" cy="50" r="2" fill="#1F2333" />
        {wink ? <path d="M70 51 Q76 45 82 51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" /> : <><circle cx="75" cy="50" r="4" fill="#fff" /><circle cx="74" cy="50" r="2" fill="#1F2333" /></>}
      </g>
      <ellipse cx="60" cy="62" rx="5" ry="3.5" fill="#1F2333" />
      <path d="M54 67 Q60 73 66 67" stroke="#1F2333" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="33" cy="64" r="5" fill="#FF9DB5" opacity=".7" />
      <circle cx="87" cy="64" r="5" fill="#FF9DB5" opacity=".7" />
    </>
  )
}

export function Bao({ pose = 'stand', className }: { pose?: 'stand' | 'peek' | 'laptop'; className?: string }) {
  if (pose === 'peek') {
    return (
      <Mascot slot="bao-wink" label="Bao the panda peeking and winking" className={className}>
        <svg viewBox="0 0 120 100" className="h-full w-full overflow-visible">
          <g className="m-bob"><BaoHead wink /></g>
          <ellipse cx="34" cy="92" rx="13" ry="9" fill="#1F2333" />
          <ellipse cx="86" cy="92" rx="13" ry="9" fill="#1F2333" />
        </svg>
      </Mascot>
    )
  }
  if (pose === 'laptop') {
    return (
      <Mascot slot="bao-laptop" label="Bao the panda working on a laptop" className={className}>
        <svg viewBox="0 0 120 132" className="h-full w-full overflow-visible">
          <g className="m-bob"><BaoHead /></g>
          <ellipse cx="60" cy="104" rx="34" ry="22" fill="#fff" stroke="#1F2333" strokeWidth="2.5" />
          <rect x="24" y="84" width="72" height="40" rx="5" fill="#CBD5E1" stroke="#475569" strokeWidth="2" />
          <circle cx="60" cy="104" r="6" fill="#F47B20" />
          <rect x="12" y="122" width="96" height="7" rx="3.5" fill="#94A3B8" />
          <ellipse cx="38" cy="121" rx="10" ry="6" fill="#1F2333" className="m-type" style={origin(38, 121)} />
          <ellipse cx="82" cy="121" rx="10" ry="6" fill="#1F2333" className="m-type" style={{ ...origin(82, 121), animationDelay: '.2s' }} />
        </svg>
      </Mascot>
    )
  }
  return (
    <Mascot slot="bao" label="Bao the panda" className={className}>
      <svg viewBox="0 0 120 140" className="h-full w-full overflow-visible">
        <ellipse cx="60" cy="136" rx="30" ry="4" fill="#000" opacity=".08" />
        <g className="m-bob">
          <ellipse cx="44" cy="128" rx="11" ry="8" fill="#1F2333" />
          <ellipse cx="76" cy="128" rx="11" ry="8" fill="#1F2333" />
          <ellipse cx="60" cy="106" rx="30" ry="25" fill="#fff" stroke="#1F2333" strokeWidth="2.5" />
          <ellipse cx="32" cy="104" rx="9" ry="14" fill="#1F2333" transform="rotate(20 32 104)" />
          <ellipse cx="88" cy="104" rx="9" ry="14" fill="#1F2333" transform="rotate(-20 88 104)" />
          <path d="M54 110 q6 -8 12 0 q-6 8 -12 0" fill="#FF6B8A" />
          <BaoHead />
        </g>
      </svg>
    </Mascot>
  )
}

// ------------------------------------------------------------------ Kabir (boy)
function KabirHead({ cx = 70, cy = 66 }: { cx?: number; cy?: number }) {
  const dx = cx - 70, dy = cy - 66
  return (
    <g transform={`translate(${dx} ${dy})`}>
      <circle cx="38" cy="68" r="7" fill={SKIN} />
      <circle cx="102" cy="68" r="7" fill={SKIN} />
      <ellipse cx="70" cy="66" rx="32" ry="34" fill={SKIN} />
      <g fill="#3B2414">
        <path d="M38 62 Q38 30 70 30 Q102 30 102 62 Q92 46 70 48 Q48 46 38 62Z" />
        {[[44, 44, 12], [56, 34, 13], [70, 30, 14], [84, 34, 13], [96, 44, 12], [40, 54, 9], [100, 54, 9]].map(([x, y, r]) => <circle key={`${x}${y}`} cx={x} cy={y} r={r} />)}
      </g>
      <path d="M52 58 q6 -4 12 0 M76 58 q6 -4 12 0" stroke="#3B2414" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <g className="m-blink" style={origin(70, 68)}>
        <ellipse cx="58" cy="68" rx="3.5" ry="4.5" fill={INK} />
        <ellipse cx="82" cy="68" rx="3.5" ry="4.5" fill={INK} />
      </g>
      <circle cx="49" cy="78" r="5" fill="#FF9DB5" opacity=".6" />
      <circle cx="91" cy="78" r="5" fill="#FF9DB5" opacity=".6" />
      <path d="M60 82 Q70 94 80 82 Z" fill="#7A2E1F" />
    </g>
  )
}

export function Kabir({ pose = 'stand', className }: { pose?: 'stand' | 'chin' | 'laptop'; className?: string }) {
  if (pose === 'chin') {
    return (
      <Mascot slot="kabir-peek" label="Kabir resting his chin on his hands" className={className}>
        <svg viewBox="0 0 140 140" className="h-full w-full overflow-visible">
          <ellipse cx="70" cy="150" rx="48" ry="28" fill="#F47B20" />
          <path d="M36 140 L56 102" stroke="#F47B20" strokeWidth="18" strokeLinecap="round" />
          <path d="M104 140 L84 102" stroke="#F47B20" strokeWidth="18" strokeLinecap="round" />
          <KabirHead cx={70} cy={60} />
          <circle cx="56" cy="99" r="10" fill={SKIN} />
          <circle cx="84" cy="99" r="10" fill={SKIN} />
        </svg>
      </Mascot>
    )
  }
  if (pose === 'laptop') {
    return (
      <Mascot slot="kabir-laptop" label="Kabir lying on his tummy, typing on a laptop" className={className}>
        <svg viewBox="0 0 170 100" className="h-full w-full overflow-visible">
          <ellipse cx="96" cy="96" rx="66" ry="4" fill="#000" opacity=".08" />
          <path d="M126 84 L160 88" stroke={SKIN} strokeWidth="9" strokeLinecap="round" />
          <g className="m-kick" style={origin(126, 82)}>
            <path d="M126 82 L146 50" stroke={SKIN} strokeWidth="9" strokeLinecap="round" />
            <ellipse cx="148" cy="46" rx="8" ry="5" fill="#2E3A8C" transform="rotate(-50 148 46)" />
          </g>
          <rect x="104" y="72" width="28" height="18" rx="7" fill="#2E3A8C" />
          <ellipse cx="88" cy="80" rx="34" ry="13" fill="#F47B20" />
          <rect x="6" y="60" width="34" height="26" rx="3" fill="#CBD5E1" stroke="#475569" strokeWidth="2" transform="rotate(-8 23 73)" />
          <path d="M12 78 l7 -6 l6 4 l8 -8" stroke="#0E9F6E" strokeWidth="2" fill="none" strokeLinecap="round" transform="rotate(-8 23 73)" />
          <rect x="2" y="86" width="50" height="5" rx="2.5" fill="#94A3B8" />
          <path d="M64 80 L46 84" stroke={SKIN} strokeWidth="8" strokeLinecap="round" className="m-type" style={origin(46, 84)} />
          <g transform="scale(.62) translate(10 -10)"><KabirHead cx={78} cy={92} /></g>
        </svg>
      </Mascot>
    )
  }
  return (
    <Mascot slot="kabir-peek" label="Kabir waving" className={className}>
      <svg viewBox="0 0 140 180" className="h-full w-full overflow-visible">
        <ellipse cx="70" cy="176" rx="30" ry="4" fill="#000" opacity=".08" />
        <g className="m-bob">
          <rect x="54" y="144" width="12" height="28" rx="5" fill="#2E3A8C" />
          <rect x="74" y="144" width="12" height="28" rx="5" fill="#2E3A8C" />
          <path d="M44 106 Q70 96 96 106 L100 148 L40 148Z" fill="#F47B20" />
          <path d="M46 110 L34 136" stroke={SKIN} strokeWidth="9" strokeLinecap="round" />
          <g className="m-wave" style={origin(94, 110)}>
            <path d="M94 110 L112 86" stroke={SKIN} strokeWidth="9" strokeLinecap="round" />
            <circle cx="114" cy="82" r="7" fill={SKIN} />
          </g>
          <KabirHead cx={70} cy={66} />
        </g>
      </svg>
    </Mascot>
  )
}

// ------------------------------------------------------------------ Meera (girl)
export function Meera({ className }: { className?: string }) {
  const skin = '#F7D2B1'
  return (
    <Mascot slot="meera" label="Meera making a peace sign" className={className}>
      <svg viewBox="0 0 120 176" className="h-full w-full overflow-visible">
        <ellipse cx="60" cy="172" rx="28" ry="4" fill="#000" opacity=".08" />
        <g className="m-bob">
          <rect x="47" y="138" width="10" height="28" rx="4" fill={skin} />
          <rect x="63" y="138" width="10" height="28" rx="4" fill={skin} />
          <ellipse cx="52" cy="166" rx="8" ry="4" fill="#7C3AED" /><ellipse cx="68" cy="166" rx="8" ry="4" fill="#7C3AED" />
          <path d="M38 98 Q60 90 82 98 L92 142 L28 142Z" fill="#F472B6" />
          <path d="M40 104 L30 130" stroke={skin} strokeWidth="8" strokeLinecap="round" />
          <g className="m-wave" style={origin(80, 104)}>
            <path d="M80 104 L98 80" stroke={skin} strokeWidth="8" strokeLinecap="round" />
            <circle cx="99" cy="76" r="6" fill={skin} />
            <path d="M97 72 L93 59 M101 72 L107 60" stroke={skin} strokeWidth="4" strokeLinecap="round" />
          </g>
          <circle cx="30" cy="30" r="13" fill="#2B1A12" /><circle cx="90" cy="30" r="13" fill="#2B1A12" />
          <rect x="36" y="38" width="8" height="5" rx="2" fill="#F472B6" transform="rotate(35 40 40)" />
          <rect x="76" y="38" width="8" height="5" rx="2" fill="#F472B6" transform="rotate(-35 80 40)" />
          <ellipse cx="60" cy="64" rx="33" ry="33" fill="#2B1A12" />
          <ellipse cx="60" cy="68" rx="27" ry="28" fill={skin} />
          <path d="M33 62 Q36 36 60 36 Q84 36 87 62 Q74 48 60 52 Q46 48 33 62Z" fill="#2B1A12" />
          <g className="m-blink" style={origin(60, 70)}>
            <ellipse cx="49" cy="70" rx="3.5" ry="4.5" fill={INK} />
            <ellipse cx="71" cy="70" rx="3.5" ry="4.5" fill={INK} />
          </g>
          <circle cx="42" cy="80" r="4.5" fill="#FF9DB5" opacity=".7" />
          <circle cx="78" cy="80" r="4.5" fill="#FF9DB5" opacity=".7" />
          <path d="M53 82 Q60 89 67 82" stroke="#B4235A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      </svg>
    </Mascot>
  )
}

// ------------------------------------------------------------------ small decorations
export function Cloud({ className, style }: { className?: string; style?: CSSProperties }) {
  return <svg viewBox="0 0 64 32" className={className} style={style} aria-hidden="true"><path d="M14 30h38a10 10 0 0 0 0-20 14 14 0 0 0-26-4A11 11 0 0 0 14 30z" fill="currentColor" /></svg>
}
export function PaperPlane({ className }: { className?: string }) {
  return <svg viewBox="0 0 48 48" className={className} aria-hidden="true"><path d="M4 22 44 6 34 42 24 30 4 22z" fill="#fff" stroke="#2E3A8C" strokeWidth="2.5" strokeLinejoin="round" /><path d="M24 30 44 6 18 27" fill="none" stroke="#2E3A8C" strokeWidth="2.5" strokeLinejoin="round" /></svg>
}
export function Twinkle({ className, style, heart }: { className?: string; style?: CSSProperties; heart?: boolean }) {
  return heart
    ? <svg viewBox="0 0 24 24" className={cx('m-twinkle', className)} style={style} aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="currentColor" /></svg>
    : <svg viewBox="0 0 24 24" className={cx('m-twinkle', className)} style={style} aria-hidden="true"><path d="M12 0 14.6 9.4 24 12 14.6 14.6 12 24 9.4 14.6 0 12 9.4 9.4z" fill="currentColor" /></svg>
}
export function Plant({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 90" className={className} aria-hidden="true">
      <g className="m-sway" style={origin(30, 62)}>
        <path d="M30 62 C28 44 20 34 10 28 C20 30 28 38 30 50 C31 36 36 22 48 14 C40 26 34 40 31 62" fill="#22A06B" />
        <path d="M30 62 C32 48 40 40 52 38 C44 44 36 52 32 62" fill="#34C38F" />
      </g>
      <path d="M16 60h28l-4 28H20z" fill="#F47B20" />
      <rect x="13" y="56" width="34" height="7" rx="3" fill="#DF6A12" />
    </svg>
  )
}
export function MiniLaptop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 62" className={className} aria-hidden="true">
      <rect x="12" y="4" width="66" height="44" rx="5" fill="#fff" stroke="#2E3A8C" strokeWidth="3" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={22 + i * 13} y={38 - [10, 18, 13, 24][i]!} width="8" height={[10, 18, 13, 24][i]} rx="2" fill={i === 3 ? '#F47B20' : '#8EA8F5'} />)}
      <path d="M2 50h86l-6 10H8z" fill="#2E3A8C" />
    </svg>
  )
}
