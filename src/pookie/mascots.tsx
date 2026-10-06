import React from 'react'

export interface MascotProps {
  className?: string
  alt?: string
  size?: number | string
  style?: React.CSSProperties
}

// 1. Blue robotic cat
export function BlueCat({
  pose = 'default',
  className = '',
  size = 56,
  style,
}: {
  pose?: 'default' | 'thumbs-up' | 'cheering' | 'sleeping' | 'magnifying' | 'lock' | 'calculator'
  className?: string
  size?: number | string
  style?: React.CSSProperties
}) {
  let src = '/mascots/bluecat.png'
  if (pose === 'thumbs-up') src = '/mascots/kpi-bluecat-thumb.png'
  if (pose === 'cheering') src = '/mascots/cheer-cat.png'
  if (pose === 'sleeping') src = '/mascots/sleeping-cat.png'

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={src}
        alt="Blue Cat Mascot"
        className="w-full h-full object-contain filter drop-shadow-sm transition-transform hover:scale-105 duration-200"
        loading="lazy"
      />
      {pose === 'sleeping' && (
        <span className="absolute -top-1 right-1 text-[11px] font-extrabold text-blue-400 animate-pulse">
          z Z
        </span>
      )}
    </div>
  )
}

// 2. Schoolgirl
export function Schoolgirl({
  pose = 'default',
  className = '',
  size = 56,
  style,
}: {
  pose?: 'default' | 'coffee' | 'two-girls' | 'clipboard' | 'laptop'
  className?: string
  size?: number | string
  style?: React.CSSProperties
}) {
  let src = '/mascots/schoolgirl.png'
  if (pose === 'coffee') src = '/mascots/kpi-coffee-girl.png'
  if (pose === 'two-girls') src = '/mascots/kpi-schoolgirls.png'

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={src}
        alt="Schoolgirl Mascot"
        className="w-full h-full object-contain filter drop-shadow-sm transition-transform hover:scale-105 duration-200"
        loading="lazy"
      />
    </div>
  )
}

// 3. Schoolboy
export function Schoolboy({
  pose = 'default',
  className = '',
  size = 56,
  style,
}: {
  pose?: 'default' | 'peeking' | 'running' | 'calculator'
  className?: string
  size?: number | string
  style?: React.CSSProperties
}) {
  let src = '/mascots/schoolboy.png'
  if (pose === 'peeking') src = '/mascots/peek-shinchan.png'

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={src}
        alt="Schoolboy Mascot"
        className="w-full h-full object-contain filter drop-shadow-sm transition-transform hover:scale-105 duration-200"
        loading="lazy"
      />
    </div>
  )
}

// 4. Blonde fashion doll
export function BlondeGirl({
  pose = 'default',
  className = '',
  size = 56,
  style,
}: {
  pose?: 'default' | 'birthday-cake' | 'celebrating'
  className?: string
  size?: number | string
  style?: React.CSSProperties
}) {
  let src = '/mascots/blonde.png'
  if (pose === 'birthday-cake') src = '/mascots/birthday-girl.png'

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={src}
        alt="Blonde Doll Mascot"
        className="w-full h-full object-contain filter drop-shadow-sm transition-transform hover:scale-105 duration-200"
        loading="lazy"
      />
    </div>
  )
}

// 5. Panda
export function Panda({
  pose = 'default',
  className = '',
  size = 56,
  style,
}: {
  pose?: 'default' | 'peeking' | 'pipeline' | 'card'
  className?: string
  size?: number | string
  style?: React.CSSProperties
}) {
  let src = '/mascots/panda.png'
  if (pose === 'peeking') src = '/mascots/peek-panda.png'
  if (pose === 'pipeline') src = '/mascots/peek-pipeline-panda.png'
  if (pose === 'card') src = '/mascots/kpi-panda-kpi.png'

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <img
        src={src}
        alt="Panda Mascot"
        className="w-full h-full object-contain filter drop-shadow-sm transition-transform hover:scale-105 duration-200"
        loading="lazy"
      />
    </div>
  )
}

// Sparkles and tiny cute shapes
export function CuteSparkle({ className = 'text-amber-400', size = 14 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`inline-block anim-sparkle ${className}`}
    >
      <path d="M12 0L14.6 9.4L24 12L14.6 14.6L12 24L9.4 14.6L0 12L9.4 9.4L12 0Z" />
    </svg>
  )
}

export function CuteHeart({ className = 'text-pink-400', size = 14 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`inline-block ${className}`}
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

export function CuteStar({ className = 'text-amber-300', size = 14 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`inline-block anim-pulse-soft ${className}`}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

// Logo Mascot Head: Yellow bear/hamster with pink cheeks
export function PookieLogoMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-2xl bg-amber-100 shadow-sm border border-amber-200"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.75} height={size * 0.75} viewBox="0 0 100 100" fill="none">
        {/* Ears */}
        <circle cx="28" cy="28" r="14" fill="#F59E0B" />
        <circle cx="28" cy="28" r="8" fill="#FDE68A" />
        <circle cx="72" cy="28" r="14" fill="#F59E0B" />
        <circle cx="72" cy="28" r="8" fill="#FDE68A" />
        {/* Head */}
        <ellipse cx="50" cy="56" rx="36" ry="32" fill="#FBBF24" />
        {/* Snout */}
        <ellipse cx="50" cy="62" rx="14" ry="10" fill="#FEF3C7" />
        {/* Nose */}
        <ellipse cx="50" cy="58" rx="4" ry="3" fill="#92400E" />
        {/* Mouth */}
        <path d="M47 62 Q50 66 53 62" stroke="#92400E" strokeWidth="2" strokeLinecap="round" />
        {/* Eyes */}
        <circle cx="38" cy="50" r="4.5" fill="#1F2937" />
        <circle cx="40" cy="48" r="1.5" fill="#FFFFFF" />
        <circle cx="62" cy="50" r="4.5" fill="#1F2937" />
        <circle cx="64" cy="48" r="1.5" fill="#FFFFFF" />
        {/* Cheeks */}
        <circle cx="30" cy="58" r="5" fill="#F472B6" opacity="0.75" />
        <circle cx="70" cy="58" r="5" fill="#F472B6" opacity="0.75" />
      </svg>
    </div>
  )
}
