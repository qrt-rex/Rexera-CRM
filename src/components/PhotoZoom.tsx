import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import { Avatar, cx } from './ui'

/** Avatar you can tap to see the profile photo large, with zoom (buttons, wheel, double-tap). */
export function ZoomAvatar({ name, photo, size = 40, sub, className }: { name: string; photo?: string; size?: number; sub?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} aria-label={`View ${name}'s photo`} title="View photo"
        className={cx('shrink-0 rounded-full transition hover:ring-2 hover:ring-brand/40 focus-visible:ring-2', className)}>
        <Avatar name={name} photo={photo} size={size} />
      </button>
      {open && <PhotoViewer name={name} photo={photo} sub={sub} onClose={() => setOpen(false)} />}
    </>
  )
}

export function PhotoViewer({ name, photo, sub, onClose }: { name: string; photo?: string; sub?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.5)); if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5)) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#05070f]/85 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button aria-label="Close" onClick={onClose} className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="size-5" /></button>
      <div className="grid size-[min(78vw,420px)] place-items-center overflow-hidden rounded-3xl bg-white/5"
        onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))))}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}>
        {photo
          ? <img src={photo} alt={name} draggable={false} style={{ transform: `scale(${zoom})` }} className="size-full select-none object-cover transition-transform duration-200" />
          : <div style={{ transform: `scale(${zoom})` }} className="transition-transform duration-200"><Avatar name={name} size={200} /></div>}
      </div>
      <p className="mt-4 text-lg font-bold text-white">{name}</p>
      {sub && <p className="text-sm text-white/70">{sub}</p>}
      <div className="mt-4 flex items-center gap-3 rounded-full bg-white/10 px-3 py-1.5 text-white">
        <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="grid size-8 place-items-center rounded-full hover:bg-white/15"><Minus className="size-4" /></button>
        <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="w-32 accent-white" />
        <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} className="grid size-8 place-items-center rounded-full hover:bg-white/15"><Plus className="size-4" /></button>
        <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>
      {!photo && <p className="mt-2 text-xs text-white/60">No profile photo yet</p>}
    </div>,
    document.body,
  )
}
