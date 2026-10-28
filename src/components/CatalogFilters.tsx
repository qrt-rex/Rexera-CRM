import type { DB } from '../lib/types'
import { Select } from './ui'

/**
 * Price-wise and scheme-wise filters shared by the Sales Kit, Schemes and Flyers pages. Each page passes what it
 * knows (a price, a scheme name); nothing here reads or changes the pages' own data.
 */
export const PRICE_BANDS = [
  { id: 'all', label: 'Any price' },
  { id: 'upto5k', label: 'Up to ₹5,000', min: 0, max: 5000 },
  { id: '5k-10k', label: '₹5,001 – ₹10,000', min: 5001, max: 10000 },
  { id: '10k-20k', label: '₹10,001 – ₹20,000', min: 10001, max: 20000 },
  { id: '20k-50k', label: '₹20,001 – ₹50,000', min: 20001, max: 50000 },
  { id: 'over50k', label: 'Above ₹50,000', min: 50001, max: Infinity },
  { id: 'none', label: 'No price set' },
] as const
export type PriceBand = (typeof PRICE_BANDS)[number]['id']
export type PriceSort = '' | 'asc' | 'desc'

/** The first amount in a text such as "INR 15,000 + 18% GST" (15000), or undefined. */
export const priceFromText = (s?: string) => {
  const m = (s ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : undefined
}
export function inPriceBand(price: number | undefined, band: PriceBand) {
  if (band === 'all') return true
  if (band === 'none') return price == null
  const b = PRICE_BANDS.find((x) => x.id === band) as { min: number; max: number }
  return price != null && price >= b.min && price <= b.max
}
/** Sorts by price (no price last) when a sort is chosen; otherwise keeps the order. */
export const byPrice = <T,>(list: T[], price: (x: T) => number | undefined, sort: PriceSort) => !sort ? list
  : [...list].sort((a, b) => { const pa = price(a), pb = price(b); return pa == null ? 1 : pb == null ? -1 : sort === 'asc' ? pa - pb : pb - pa })

/** The scheme a piece of text is about (a flyer's title / body), from the Schemes and Sales Kit names; longest name first. */
export function schemeIn(db: DB, text: string) {
  const t = text.toLowerCase()
  return schemeNames(db).sort((a, b) => b.length - a.length).find((n) => n.length > 2 && t.includes(n.toLowerCase()))
}
/** Every scheme name the CRM knows (Schemes and Sales Kit), once each. */
export const schemeNames = (db: DB) => [...new Map([...db.schemes.map((s) => s.title), ...(db.salesKit ?? []).map((x) => x.name)]
  .map((n) => n.trim()).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()]
/** A scheme's price: the Schemes price, else the Sales Kit charge. */
export const schemePrice = (db: DB, name?: string) => {
  if (!name) return undefined
  const k = name.trim().toLowerCase()
  return db.schemes.find((s) => s.title.trim().toLowerCase() === k)?.price ?? priceFromText((db.salesKit ?? []).find((x) => x.name.trim().toLowerCase() === k)?.minCharge)
}

export function PriceFilter({ band, sort, onBand, onSort }: { band: PriceBand; sort: PriceSort; onBand: (b: PriceBand) => void; onSort: (s: PriceSort) => void }) {
  return (
    <>
      <Select aria-label="Price" value={band} onChange={(e) => onBand(e.target.value as PriceBand)} className="w-44">
        {PRICE_BANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </Select>
      <Select aria-label="Sort by price" value={sort} onChange={(e) => onSort(e.target.value as PriceSort)} className="w-44">
        <option value="">Default order</option><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option>
      </Select>
    </>
  )
}
export function OptionFilter({ label, all, value, options, onChange }: { label: string; all: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-52">
      <option value="">{all}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
  )
}
