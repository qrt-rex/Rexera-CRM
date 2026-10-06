import { useId } from 'react'
import { INDIAN_CITIES, stateForCity } from '../lib/india'
import { INDIAN_STATES, isPhone } from '../lib/format'
import { Input, Select } from './ui'

/** 10-digit Indian mobile: digits only, never more than 10, checked as it's typed. */
export function PhoneInput({ label = 'Mobile number', value, onChange, required, className, hint, showError = true }: {
  label?: string; value: string; onChange: (v: string) => void; required?: boolean; className?: string; hint?: string; showError?: boolean
}) {
  const digits = value.replace(/\D/g, '')
  const error = showError && digits.length > 0 && !isPhone(digits) ? (digits.length < 10 ? `${10 - digits.length} more digit${digits.length === 9 ? '' : 's'}` : 'A mobile number starts with 6, 7, 8 or 9') : undefined
  return (
    <Input label={label} required={required} className={className} type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="10-digit mobile"
      value={digits} error={error} hint={error ? undefined : hint}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10})/, '').slice(0, 10))}
      onPaste={(e) => { e.preventDefault(); onChange(e.clipboardData.getData('text').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').slice(-10)) }} />
  )
}

/** City with suggestions; picking a known city fills the state through `onState`. */
export function CityInput({ label = 'City', value, onChange, onState, required, className }: {
  label?: string; value: string; onChange: (v: string) => void; onState?: (state: string) => void; required?: boolean; className?: string
}) {
  const id = useId()
  const st = stateForCity(value)
  return (
    <>
      <Input label={label} required={required} className={className} list={id} autoComplete="address-level2" value={value} placeholder="Start typing a city"
        hint={st ? `State: ${st}` : undefined}
        onChange={(e) => { onChange(e.target.value); const s = stateForCity(e.target.value); if (s) onState?.(s) }} />
      <datalist id={id}>{INDIAN_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  )
}

export function StateSelect({ label = 'State', value, onChange, required, className }: { label?: string; value: string; onChange: (v: string) => void; required?: boolean; className?: string }) {
  return (
    <Select label={label} required={required} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select state —</option>
      {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
    </Select>
  )
}
