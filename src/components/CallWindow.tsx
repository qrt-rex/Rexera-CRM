import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal, Maximize2, Minus, X } from 'lucide-react'
import { cx } from './ui'

const W = 368
const POS_KEY = 'rexera-call-window-pos'
const fit = () => Math.min(W, window.innerWidth - 16)
/** Keeps the window on screen: at least its title bar stays visible. */
const clamp = (p: { x: number; y: number }) => ({
  x: Math.round(Math.min(Math.max(8, p.x), window.innerWidth - fit() - 8)),
  y: Math.round(Math.min(Math.max(8, p.y), window.innerHeight - 60)),
})
const start = () => {
  try { const s = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (s && typeof s.x === 'number') return clamp(s) } catch { /* ignore */ }
  return clamp({ x: window.innerWidth - fit() - 24, y: 84 })   // top-right, under the header (Rexy sits bottom-right)
}

/**
 * A floating window that stays on top while a call is on. Drag it anywhere by the title bar (mouse or touch), or focus the
 * title bar and use the arrow keys. It remembers where you left it and can be shrunk to the title bar.
 */
export function CallWindow({ title, subtitle, status, timer, live, onClose, closeLabel = 'Close', children }: {
  title: ReactNode; subtitle?: ReactNode; status: ReactNode; timer?: string; live: boolean
  onClose: () => void; closeLabel?: string; children: ReactNode
}) {
  const [pos, setPos] = useState(start)
  const [small, setSmall] = useState(false)
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null)
  const save = useCallback((p: { x: number; y: number }) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* ignore */ } }, [])

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return
    drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    // keep getting moves even when the pointer leaves the bar (some browsers/pens refuse capture: dragging still works)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setPos((p) => { save(p); return p })
  }
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    setPos((p) => { const n = clamp({ x: p.x + d[0]!, y: p.y + d[1]! }); save(n); return n })
  }

  return createPortal(
    <section role="dialog" aria-label="Call in progress" style={{ left: pos.x, top: pos.y, width: fit() }}
      className="no-print anim-pop fixed z-[85] overflow-hidden rounded-2xl border border-line bg-card shadow-pop">
      <div tabIndex={0} role="toolbar" aria-label="Call window — drag, or use the arrow keys, to move it"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={keys}
        className={cx('flex cursor-grab touch-none select-none items-center gap-3 px-3 py-2.5 text-white outline-none focus-visible:ring-4 focus-visible:ring-accent/50 active:cursor-grabbing',
          live ? 'bg-gradient-to-r from-[#0E9F6E] to-[#0891b2]' : 'bg-gradient-to-r from-[#2E3A8C] to-[#4453b5]')}>
        <GripHorizontal className="size-4 shrink-0 text-white/60" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold">{title}</span>
          <span className="flex items-center gap-1.5 truncate text-[11px] text-white/85">
            {live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-white" /></span>}
            {status}{subtitle ? <> · {subtitle}</> : null}
          </span>
        </span>
        {timer && <span className="font-mono text-lg font-bold tabular-nums">{timer}</span>}
        <button aria-label={small ? 'Expand call window' : 'Shrink call window'} title={small ? 'Expand' : 'Shrink'} onClick={() => setSmall(!small)}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white">{small ? <Maximize2 className="size-4" /> : <Minus className="size-4" />}</button>
        <button aria-label={closeLabel} title={closeLabel} onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-white/85 hover:bg-white/15 hover:text-white"><X className="size-4" /></button>
      </div>
      {/* the body scrolls inside the space left below the window, so nothing ends up off screen */}
      {!small && <div className="overflow-y-auto p-4" style={{ maxHeight: Math.min(560, Math.max(160, window.innerHeight - pos.y - 68)) }}>{children}</div>}
    </section>,
    document.body,
  )
}
