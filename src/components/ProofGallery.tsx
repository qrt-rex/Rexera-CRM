import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ImageOff, Loader2, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { getFile, openFile } from '../lib/files'
import { cx, useToast } from './ui'

/**
 * Proof screenshots and documents of a client file, shown whole (object-fit: contain — never cropped), and a large
 * viewer on click: zoom in / out / fit (buttons, + / − keys, Ctrl + mouse wheel), drag-free panning by scrolling,
 * previous / next, download. PDFs open in a new tab.
 */
export interface ProofItem { key: string; file: FileRef; title: string; sub?: string; badge?: React.ReactNode }

const isImage = (f: FileRef) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(f.name)

/** An object URL for a stored file (Supabase bucket or this browser's store), released when no longer shown. */
export function useFileUrl(file?: FileRef) {
  const [state, setState] = useState<{ url?: string; error?: boolean }>({})
  useEffect(() => {
    if (!file) return
    let url: string | undefined, stop = false
    setState({})
    getFile(file.id).then((blob) => {
      if (stop) return
      if (!blob) { setState({ error: true }); return }
      url = URL.createObjectURL(blob)
      setState({ url })
    }, () => { if (!stop) setState({ error: true }) })
    return () => { stop = true; if (url) URL.revokeObjectURL(url) }
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

export function ProofGallery({ items, empty = 'No proof uploaded yet.' }: { items: ProofItem[]; empty?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const toast = useToast()
  const images = items.filter((x) => isImage(x.file))
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-mute">{empty}</p>
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-2 2xl:grid-cols-3">
        {items.map((it) => (
          <li key={it.key} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-card">
            {isImage(it.file)
              ? <Thumb file={it.file} title={it.title} onOpen={() => setOpen(images.indexOf(it))} />
              : <button type="button" onClick={() => openFile(it.file).catch((e) => toast('error', e.message))} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-card2 text-mute hover:text-ink">
                <FileText className="size-10" /><span className="inline-flex items-center gap-1 text-xs font-semibold">Open {it.file.name.split('.').pop()?.toUpperCase() || 'file'}<ExternalLink className="size-3" /></span>
              </button>}
            <div className="flex items-start gap-2 border-t border-line px-3 py-2">
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold" title={it.title}>{it.title}</p>{it.sub && <p className="truncate text-[11px] text-mute" title={it.sub}>{it.sub}</p>}</div>
              {it.badge}
            </div>
          </li>
        ))}
      </ul>
      {open !== null && open >= 0 && <Lightbox items={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

function Thumb({ file, title, onOpen }: { file: FileRef; title: string; onOpen: () => void }) {
  const { url, error } = useFileUrl(file)
  return (
    <button type="button" onClick={onOpen} aria-label={`View ${title} full size`} className="relative block aspect-[4/3] w-full bg-[repeating-conic-gradient(var(--card2)_0%_25%,var(--card)_0%_50%)] bg-[length:16px_16px]">
      {url ? <img src={url} alt={title} loading="lazy" className="absolute inset-0 size-full object-contain p-1" />
        : <span className="absolute inset-0 grid place-items-center text-mute">{error ? <span className="flex flex-col items-center gap-1 text-xs"><ImageOff className="size-6" />Not available</span> : <Loader2 className="size-5 animate-spin" />}</span>}
      <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 className="size-3.5" /></span>
    </button>
  )
}

const ZOOMS = [1, 1.5, 2, 3, 4]
function Lightbox({ items, index, onIndex, onClose }: { items: ProofItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const it = items[index]!
  const { url, error } = useFileUrl(it.file)
  const [z, setZ] = useState(0)
  // the screenshot's width when it fits the screen: zooming scales from there
  const [fitW, setFitW] = useState(0)
  useEffect(() => { setFitW(0) }, [it.key])
  const toast = useToast()
  const zoom = ZOOMS[z]!
  const step = useCallback((d: number) => setZ((x) => Math.max(0, Math.min(ZOOMS.length - 1, x + d))), [])
  const go = useCallback((d: number) => { if (items.length > 1) { onIndex((index + d + items.length) % items.length); setZ(0) } }, [index, items.length, onIndex])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') step(1)
      else if (e.key === '-') step(-1)
      else if (e.key === '0') setZ(0)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose, step, go])
  const download = () => openFile(it.file, true).catch((e) => toast('error', e.message))
  const btn = 'grid size-9 place-items-center rounded-lg text-white/90 hover:bg-white/15 disabled:opacity-40'
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={it.title} className="fixed inset-0 z-[90] flex flex-col bg-[#0b1020]/95 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-white sm:px-4">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{it.title}</p><p className="truncate text-xs text-white/60">{[it.sub, it.file.name, items.length > 1 ? `${index + 1} of ${items.length}` : ''].filter(Boolean).join(' · ')}</p></div>
        <button type="button" className={btn} onClick={() => step(-1)} disabled={z === 0} aria-label="Zoom out" title="Zoom out (−)"><ZoomOut className="size-5" /></button>
        <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => step(1)} disabled={z === ZOOMS.length - 1} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn className="size-5" /></button>
        <button type="button" className={btn} onClick={() => setZ(0)} disabled={z === 0} aria-label="Fit to screen" title="Fit to screen (0)"><Maximize2 className="size-5" /></button>
        <button type="button" className={btn} onClick={download} aria-label="Download" title="Download"><Download className="size-5" /></button>
        <button type="button" className={btn} onClick={onClose} aria-label="Close" title="Close (Esc)"><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* fit: the whole screenshot in view (a flex box of definite height, so max-height: 100% holds);
            zoomed: that fitted size × the zoom, scroll to move around it */}
        <div className={cx('absolute inset-0 overflow-auto', z === 0 && 'flex items-center justify-center p-3')}
          onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1) } }}
          onDoubleClick={() => setZ((x) => (x === 0 ? 2 : 0))}>
          {url ? <img src={url} alt={it.title} draggable={false}
            onLoad={(e) => { if (z === 0) setFitW(e.currentTarget.getBoundingClientRect().width) }}
            ref={(el) => { if (el && z === 0 && el.complete && el.naturalWidth) { const w = el.getBoundingClientRect().width; if (w && Math.abs(w - fitW) > 1) setFitW(w) } }}
            className={cx('select-none', z === 0 ? 'max-h-full max-w-full object-contain' : 'mx-auto my-3 block max-w-none')}
            style={z === 0 ? undefined : { width: fitW ? `${Math.round(fitW * zoom)}px` : `${zoom * 100}%` }} />
            : <p className="grid h-full place-items-center text-sm text-white/70">{error ? 'This file could not be loaded.' : <Loader2 className="size-6 animate-spin" />}</p>}
        </div>
        {items.length > 1 && <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65"><ChevronLeft className="size-6" /></button>
          <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65"><ChevronRight className="size-6" /></button>
        </>}
      </div>
      <p className="px-4 pb-2 text-center text-[11px] text-white/50">+ / − to zoom · double-click to zoom · ← → for the next proof · Esc to close</p>
    </div>,
    document.body,
  )
}
