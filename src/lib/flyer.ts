import type { Post } from './types'

const THEME_COLORS: Record<string, [string, string]> = {
  navy: ['#2E3A8C', '#4b5bc4'], orange: ['#F47B20', '#F4A12A'], violet: ['#6D28D9', '#a855f7'], green: ['#047857', '#10b981'], gray: ['#1f2937', '#4b5563'],
}
const SIZE = 1080

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word } else line = test
    }
    out.push(line)
  }
  return out
}

/** Draws the flyer on a 1080×1080 canvas (same look as the card on screen). */
export async function drawFlyer(p: Post): Promise<HTMLCanvasElement> {
  await document.fonts?.ready
  const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE
  const ctx = c.getContext('2d')!
  const [a, b] = THEME_COLORS[p.theme] ?? THEME_COLORS.navy!
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE); g.addColorStop(0, a); g.addColorStop(1, b)
  ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(SIZE - 40, 40, 260, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.arc(80, SIZE - 60, 200, 0, Math.PI * 2); ctx.fill()
  const font = '"Plus Jakarta Sans", Inter, "Segoe UI", Arial, sans-serif'
  // brand row
  ctx.fillStyle = '#fff'; roundRect(ctx, 80, 92, 64, 64, 16); ctx.fill()
  ctx.fillStyle = a; ctx.font = `800 38px ${font}`; ctx.textBaseline = 'middle'; ctx.fillText('R', 99, 126)
  ctx.fillStyle = '#fff'; ctx.font = `800 34px ${font}`
  ctx.save(); (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '12px'; ctx.fillText('REXERA', 168, 126); ctx.restore()
  // title + body
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 84px ${font}`
  let y = 300
  for (const line of wrap(ctx, p.title, SIZE - 160).slice(0, 4)) { ctx.fillText(line, 80, y); y += 96 }
  ctx.globalAlpha = 0.92; ctx.font = `500 40px ${font}`; y += 20
  for (const line of wrap(ctx, p.body, SIZE - 160).slice(0, 9)) { ctx.fillText(line, 80, y); y += 56 }
  ctx.globalAlpha = 0.8; ctx.font = `500 30px ${font}`
  ctx.fillText('rexera.co.in · Government grants, certifications & funding', 80, SIZE - 80)
  ctx.globalAlpha = 1
  return c
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

const fileName = (p: Post, ext: string) => `${p.title.replace(/[^\w\s-]/g, '').trim().slice(0, 40).replace(/\s+/g, '-') || 'flyer'}.${ext}`
function save(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}

export async function downloadFlyerJpeg(p: Post) {
  const c = await drawFlyer(p)
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image.'))), 'image/jpeg', 0.92))
  save(blob, fileName(p, 'jpg'))
}

export async function downloadFlyerPdf(p: Post) {
  const c = await drawFlyer(p)
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: [SIZE, SIZE], hotfixes: ['px_scaling'] })
  doc.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, SIZE, SIZE)
  doc.setProperties({ title: p.title, creator: 'Rexera CRM' })
  save(doc.output('blob'), fileName(p, 'pdf'))
}
