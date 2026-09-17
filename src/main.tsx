import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { ToastProvider } from './components/Toast'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    {/* basename matches Vite's base so GitHub Pages' subpath resolves.
        Path routing, not hash: whatever stands in the address bar is what
        people copy into the chat, and only the path form has a page of its
        own carrying that session's Open Graph tags
        (scripts/sessionPages.mjs). A fragment link resolves, for a crawler,
        to the site root and its one generic card. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
