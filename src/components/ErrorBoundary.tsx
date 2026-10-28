import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'

/** A page's code file is missing — the CRM was updated while this tab was open (or the connection dropped). */
const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Loading chunk/i.test(e instanceof Error ? e.message : String(e))
const RELOADED = 'rexera-chunk-reload'

/**
 * One page failing must never blank the whole CRM. A page whose code changed with a new version reloads once (the
 * fresh version loads); anything else shows a card with Reload / Back to dashboard. `resetKey` (the address) clears
 * the error when the person goes to another page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; home?: string }, { error: unknown; where?: string }> {
  state: { error: unknown; where?: string } = { error: null }
  static getDerivedStateFromError(error: unknown) { return { error } }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[page error]', error, info.componentStack)
    // where it broke, for the person to pass on: the page address and the code files it went through
    const files = [...new Set([...(info.componentStack ?? '').matchAll(/\/assets\/([\w.-]+)\.js/g)].map((m) => m[1]!.replace(/-[\w]{6,}$/, '')))].slice(0, 4)
    this.setState({ where: `${location.pathname}${location.search}${files.length ? ` · ${files.join(' › ')}` : ''}` })
    if (isChunkError(error)) {
      // reload at most once a minute, so a real outage doesn't loop
      let last = 0
      try { last = Number(sessionStorage.getItem(RELOADED)) || 0 } catch { /* storage blocked */ }
      if (Date.now() - last > 60_000) {
        try { sessionStorage.setItem(RELOADED, String(Date.now())) } catch { /* storage blocked */ }
        location.reload()
      }
    }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, where: undefined })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkError(error)
    return (
      <div role="alert" className="mx-auto my-16 max-w-lg rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-warn-soft text-warn"><AlertTriangle className="size-7" /></span>
        <h2 className="text-xl font-extrabold">{chunk ? 'The CRM was updated' : 'This page couldn’t load'}</h2>
        <p className="mt-2 text-sm text-mute">{chunk ? 'A new version is available. Reload to continue — nothing you saved is lost.' : 'Something went wrong showing this page. Your data is safe. Reload, or go back to your dashboard.'}</p>
        {!chunk && <p className="mt-3 break-words rounded-lg bg-card2 px-3 py-2 text-left font-mono text-[11px] text-mute">{error instanceof Error ? error.message : String(error)}{this.state.where && <><br />{this.state.where}</>}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => location.reload()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90"><RefreshCw className="size-4" />Reload</button>
          <a href={this.props.home ?? '/'} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-card2"><Home className="size-4" />Back to dashboard</a>
        </div>
      </div>
    )
  }
}
