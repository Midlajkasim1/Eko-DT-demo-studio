import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/boxicons.css'
import './index.css'
import App from './App'

;(window as unknown as { EKO_RUNTIME?: string }).EKO_RUNTIME = 'studio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
