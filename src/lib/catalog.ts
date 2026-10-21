import type { BookingType, Service } from './types'

/**
 * Booking types and the Application Support combo packages (Basic / Standard / Premium / Enterprise), and the
 * industry list for CRM entries. Kept free of other imports so pages and rules can share it.
 */
export const BOOKING_TYPES: { id: BookingType; label: string; short: string }[] = [
  { id: 'SINGLE', label: 'Single booking', short: 'Single' },
  { id: 'MULTIPLE', label: 'Multiple booking', short: 'Multiple' },
  { id: 'COMBO3', label: 'Combo · 3 months', short: 'Combo 3M' },
  { id: 'COMBO6', label: 'Combo · 6 months', short: 'Combo 6M' },
  { id: 'COMBO9', label: 'Combo · 9 months', short: 'Combo 9M' },
  { id: 'COMBO12', label: 'Combo · 12 months', short: 'Combo 12M' },
]
export const bookingTypeLabel = (t?: BookingType) => BOOKING_TYPES.find((x) => x.id === t)?.label ?? 'Single booking'

export interface ComboPackage {
  months: 3 | 6 | 9 | 12
  name: string
  tagline: string
  /** applications submitted at the start (minimum – maximum) */
  minApps: number
  maxApps: number
  /** further applications each month after the initial ones */
  extraPerMonth: number
  /** minimum package price to book the combo (₹, before GST) */
  minPrice: number
}
/** Application Support combo packages ("More applications, more opportunities"). */
export const COMBO_PACKAGES: Record<3 | 6 | 9 | 12, ComboPackage> = {
  3: { months: 3, name: 'Basic Package', tagline: 'Start Smart', minApps: 5, maxApps: 10, extraPerMonth: 2, minPrice: 50000 },
  6: { months: 6, name: 'Standard Package', tagline: 'Grow Faster', minApps: 6, maxApps: 12, extraPerMonth: 2, minPrice: 75000 },
  9: { months: 9, name: 'Premium Package', tagline: 'Go Further', minApps: 7, maxApps: 14, extraPerMonth: 2, minPrice: 90000 },
  12: { months: 12, name: 'Enterprise Package', tagline: 'Unlock Maximum', minApps: 8, maxApps: 18, extraPerMonth: 2, minPrice: 100000 },
}
export const comboMonths = (t?: BookingType) => (t === 'COMBO3' ? 3 : t === 'COMBO6' ? 6 : t === 'COMBO9' ? 9 : t === 'COMBO12' ? 12 : undefined) as 3 | 6 | 9 | 12 | undefined
export const comboType = (months?: number): BookingType | undefined => (months === 3 ? 'COMBO3' : months === 6 ? 'COMBO6' : months === 9 ? 'COMBO9' : months === 12 ? 'COMBO12' : undefined)
/** Most applications a combo allows over its whole period: the initial maximum + 2 a month afterwards. */
export const comboCap = (p: ComboPackage) => p.maxApps + p.extraPerMonth * p.months

/** A service's price for a booking type (blank = its normal, Single price). */
export const priceFor = (s: Pick<Service, 'price' | 'prices'>, t: BookingType = 'SINGLE') => (t === 'SINGLE' ? s.price : s.prices?.[t] ?? s.price)

/**
 * Funding services (government grants and schemes, funding / investment support — not loans): when several are on one
 * entry, one price is enough and the others may be 0. Every other service (loans, certificates and registrations,
 * company and digital services) needs its own price — price bifurcation is compulsory.
 */
export const isLoanService = (s: { name: string; category?: string }) => /\bloan|cgtmse|mudra/i.test(`${s.name} ${s.category ?? ''}`)
export const isFundingService = (s: { name: string; category?: string }) =>
  !isLoanService(s) && /grant|scheme|funding|investment|seed fund|subsidy/i.test(`${s.category ?? ''} ${s.name}`) && !/certif|registration|licen/i.test(`${s.category ?? ''}`)

/** Industries for CRM entries (Other lets the sales person type it). */
export const INDUSTRIES = [
  'Agriculture & Allied', 'Food Processing', 'Dairy & Animal Husbandry', 'Manufacturing', 'Textiles & Apparel', 'Chemicals', 'Pharma & Life Sciences',
  'Healthcare & Medical Devices', 'IT & Software', 'Electronics & Hardware', 'Automobile & Auto Components', 'Engineering & Machinery',
  'Plastics & Packaging', 'Construction & Real Estate', 'Renewable Energy', 'Education & Training', 'E-commerce & Retail', 'Trading',
  'Logistics & Transport', 'Tourism & Hospitality', 'Handicrafts & Handloom', 'Media & Entertainment', 'Financial Services', 'Beauty & Wellness',
  'Gems & Jewellery', 'Agri-tech', 'Fintech', 'Ed-tech', 'Health-tech', 'Services (Other)',
] as const
