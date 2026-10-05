import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initStore } from './lib/store'
import { applyTheme, getTheme } from './lib/auth'
import App from './App'

applyTheme(getTheme())
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'system' && applyTheme('system'))

initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
