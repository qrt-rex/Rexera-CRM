import { useEffect } from 'react'
import { getDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { blutec, DialerError } from '../lib/dialer'
import { applyBlutecCall, canMakeClientEntry, restoreBlutecEntries } from '../lib/clientEntries'
import { useToast } from './ui'

/**
 * Sales people call from Blutec's own dialer. While the CRM is open, their leads still on New are looked up in Blutec
 * (on opening, then every 10 minutes): a disposition there becomes the lead's status, and an Intro or Hot Prospect
 * also becomes a client entry (details pending). Leads updated this way no longer count as "without a disposition".
 */
export function BlutecSync() {
  const me = useMe()
  const toast = useToast()
  useEffect(() => {
    if (!canMakeClientEntry(getDb(), me)) return
    let stop = false
    const run = async () => {
      // the oldest first: those are the ones that block new leads
      // ponytail: 30 a round (3 Blutec requests each); more are picked up on the next round
      const mine = getDb().leads.filter((l) => l.assignedTo === me.id && l.status === 'NEW')
        .sort((a, b) => (a.assignedAt ?? '').localeCompare(b.assignedAt ?? '')).slice(0, 30)
      let leads = 0, entries = 0
      // entries that were refused earlier (e.g. a bad email on the lead) are made again first
      try { entries += restoreBlutecEntries(me) } catch (e) { console.warn('[blutec sync]', e) }
      for (const l of mine) {
        if (stop) return
        let b
        try { b = await blutec.leadLookup(l.phone) } catch (e) {
          // not set up / not allowed: the same for every lead, so stop this round
          if (e instanceof DialerError && [401, 403, 503].includes(e.status ?? 0)) { console.warn('[blutec sync]', e.message); break }
          continue
        }
        if (stop || !b) continue
        try { const r = applyBlutecCall(me, l.id, b); if (r) leads++; if (r === 'entry') entries++ } catch (e) { console.warn('[blutec sync]', e) }
      }
      if (entries) toast('success', `New qualified lead${entries > 1 ? 's' : ''} added from Blutec — ${entries} client entr${entries > 1 ? 'ies' : 'y'} to complete.`)
      else if (leads) toast('success', `${leads} lead${leads > 1 ? 's' : ''} updated from Blutec.`)
    }
    run()
    const t = setInterval(run, 10 * 60_000)
    return () => { stop = true; clearInterval(t) }
  }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
