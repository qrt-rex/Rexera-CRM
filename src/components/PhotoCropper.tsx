import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Check, Minus, Plus, RotateCw } from 'lucide-react'
import { Button, Modal } from './ui'

const VIEW = 300          // on-screen crop square (px)
const OUT = 512           // saved photo size (px)
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** Adjust a new profile photo: drag to position, zoom, rotate, with a grid to line it up. Returns a square JPEG data URL. */
export function PhotoCropper({ file, onCancel, onDone }: { file: File | null; onCancel: () => void; onDone: (dataUrl: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    if (!file) { setImg(null); return }
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { setImg(i); setZoom(1); setRot(0); setPos({ x: 0, y: 0 }) }
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // size at zoom 1 = the image just covers the square
  const rotated = rot % 180 !== 0
  const iw = img ? (rotated ? img.height : img.width) : 1, ih = img ? (rotated ? img.width : img.height) : 1
  const base = VIEW / Math.min(iw, ih)
  const scale = base * zoom
  const maxX = Math.max(0, (iw * scale - VIEW) / 2), maxY = Math.max(0, (ih * scale - VIEW) / 2)
  const clamp = (p: { x: number; y: number }) => ({ x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) })
  useEffect(() => { setPos((p) => clamp(p)) }, [zoom, rot]) // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: RPointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y } }
  const move = (e: RPointerEvent) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })) }
  const up = () => { drag.current = null }

  const save = () => {
    if (!img) return
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT
    const ctx = c.getContext('2d')!
    const k = OUT / VIEW
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT, OUT)
    ctx.translate(OUT / 2 + pos.x * k, OUT / 2 + pos.y * k)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.drawImage(img, (-img.width * scale * k) / 2, (-img.height * scale * k) / 2, img.width * scale * k, img.height * scale * k)
    onDone(c.toDataURL('image/jpeg', 0.9))
  }

  return (
    <Modal open={!!file} onClose={onCancel} title="Adjust your photo" subtitle="Drag to position · zoom with the slider or mouse wheel" size="sm"
      footer={<><Button variant="outline" onClick={onCancel}>Cancel</Button><Button icon={Check} disabled={!img} onClick={save}>Use photo</Button></>}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative touch-none select-none overflow-hidden rounded-2xl bg-card2" style={{ width: VIEW, height: VIEW, cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.1 : -0.1))))}>
          {img && (
            <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{ width: img.width * scale, height: img.height * scale, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) rotate(${rot}deg)` }} />
          )}
          {/* rule-of-thirds grid + round preview of the avatar */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => <span key={i} className="border border-white/40" />)}
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `0 0 0 ${VIEW}px rgba(11,16,32,.45)`, borderRadius: '50%' }} />
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
        </div>
        <div className="flex w-full items-center gap-3">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.25))} className="grid size-8 place-items-center rounded-lg border border-line hover:bg-card2"><Minus className="size-4" /></button>
          <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="flex-1 accent-[var(--brand)]" />
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="grid size-8 place-items-center rounded-lg border border-line hover:bg-card2"><Plus className="size-4" /></button>
          <button type="button" aria-label="Rotate" title="Rotate 90°" onClick={() => setRot((r) => (r + 90) % 360)} className="grid size-8 place-items-center rounded-lg border border-line hover:bg-card2"><RotateCw className="size-4" /></button>
        </div>
        <p className="text-xs text-mute">The round area is how your photo appears across the CRM.</p>
      </div>
    </Modal>
  )
}
