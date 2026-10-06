import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initStore } from './lib/store'
import { applyTheme, getTheme } from './lib/auth'
import App from './App'

applyTheme(getTheme())
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'system' && applyTheme('system'))
// numbers are typed by hand: the mouse wheel and arrow keys never change a number field
document.addEventListener('wheel', (e) => {
  const t = e.target as HTMLElement
  if (t instanceof HTMLInputElement && t.type === 'number' && document.activeElement === t) t.blur()
}, { passive: true })
document.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target instanceof HTMLInputElement && e.target.type === 'number') e.preventDefault()
})

initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
