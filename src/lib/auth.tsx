import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Perm, User } from './types'
import { useDb, mutate } from './store'
import { effectivePerms } from './rbac'
import { nowIso, uid } from './format'

const SESSION_KEY = 'rexera-session'
type Session = { userId: string; token: string; at: string }

interface AuthCtx {
  user: User | null
  perms: Set<Perm>
  can: (...p: Perm[]) => boolean
  signIn: (userId: string) => void
  signOut: (reason?: string) => void
  /** ms until auto sign-out, or null when signed out */
  warnIn: number | null
  stayActive: () => void
}
const Ctx = createContext<AuthCtx | null>(null)

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const [session, setSession] = useState<Session | null>(readSession)
  const user = useMemo(() => {
    const u = session ? db.users.find((x) => x.id === session.userId) : null
    return u && u.active ? u : null
  }, [db.users, session])
  const perms = useMemo(() => effectivePerms(db, user), [db, user])
  const can = useCallback((...p: Perm[]) => p.some((x) => perms.has(x)), [perms])

  const signIn = useCallback((userId: string) => {
    const s = { userId, token: uid('jwt-'), at: nowIso() }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    sessionStorage.removeItem('rexera-signout-reason')
    setSession(s)
  }, [])

  const signOut = useCallback((reason?: string) => {
    const cur = readSession()
    if (cur) mutate((d) => d.audit.unshift({ id: uid('a-'), at: nowIso(), by: cur.userId, action: 'SIGN_OUT', detail: reason ?? 'Signed out' }))
    try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
    if (reason) sessionStorage.setItem('rexera-signout-reason', reason)
    setSession(null)
  }, [])

  // sign-out in another tab signs out here too
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === SESSION_KEY) setSession(readSession()) }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [])

  // a deactivated account is signed out immediately
  useEffect(() => {
    if (session && !user) signOut('Your account is no longer active.')
  }, [session, user, signOut])

  // ---- inactivity timeout with 1-minute warning
  const timeoutMs = db.settings.sessionMinutes * 60000
  const last = useRef(Date.now())
  const [warnIn, setWarnIn] = useState<number | null>(null)
  const stayActive = useCallback(() => { last.current = Date.now(); setWarnIn(null) }, [])
  useEffect(() => {
    if (!user) return
    const bump = () => { if (Date.now() - last.current > 1000) last.current = Date.now() }
    const evs = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      const left = timeoutMs - (Date.now() - last.current)
      if (left <= 0) signOut('You were signed out after a period of inactivity.')
      else setWarnIn(left <= 60000 ? left : null)
    }, 1000)
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t) }
  }, [user, timeoutMs, signOut])

  const value = useMemo(() => ({ user, perms, can, signIn, signOut, warnIn, stayActive }), [user, perms, can, signIn, signOut, warnIn, stayActive])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
/** Signed-in user; only use under RequireAuth. */
export function useMe(): User {
  const { user } = useAuth()
  if (!user) throw new Error('Not signed in')
  return user
}

// ---------------- theme
export type Theme = 'light' | 'dark' | 'system'
export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try { localStorage.setItem('rexera-theme', t) } catch { /* ignore */ }
}
export function getTheme(): Theme {
  try { return (localStorage.getItem('rexera-theme') as Theme) || 'light' } catch { return 'light' }
}
