import { useEffect, useState } from 'react'
import { FileText, Film, ImageIcon, Loader2 } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { getFile } from '../lib/files'
import { cx } from './ui'

/** A media file shown in place: image, video or PDF (others: an icon). Loaded only when shown. */
export function MediaPreview({ file, compact, className }: { file: FileRef; compact?: boolean; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type === 'application/pdf' ? 'pdf' : 'other'
  useEffect(() => {
    if (kind === 'other' || (compact && kind !== 'image')) return
    let u: string | null = null, live = true
    getFile(file.id).then((b) => { if (!live) return; if (!b) { setFailed(true); return } u = URL.createObjectURL(b.type ? b : new Blob([b], { type: file.type })); setUrl(u) }, () => live && setFailed(true))
    return () => { live = false; if (u) URL.revokeObjectURL(u) }
  }, [file.id, file.type, kind, compact])
  const Icon = kind === 'video' ? Film : kind === 'image' ? ImageIcon : FileText
  const box = cx('grid place-items-center overflow-hidden rounded-xl border border-line bg-card2 text-mute', className)
  if (kind === 'other' || failed || (compact && kind !== 'image')) return <div className={box} title={file.name}><Icon className="size-6" /></div>
  if (!url) return <div className={box}><Loader2 className="size-5 animate-spin" /></div>
  if (kind === 'image') return <img src={url} alt={file.name} className={cx('rounded-xl border border-line object-cover', className)} />
  if (kind === 'video') return <video src={url} controls className={cx('rounded-xl border border-line bg-black', className)} />
  return <iframe src={url} title={file.name} className={cx('rounded-xl border border-line bg-white', className)} />
}
