import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'
import { ToastProvider } from './components/Toast'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    {/* HashRouter, not BrowserRouter, so a shared session link previews.
        GitHub Pages has no rewrite rule: it answers /sepak/s/<id> with the
        404.html fallback AND a 404 status, and WhatsApp, Telegram and
        Facebook all refuse to build a preview from a 404. With the route in
        the fragment every link is really /sepak/, which Pages serves as a
        200 carrying the Open Graph tags. Crawlers drop the fragment before
        fetching, so the tags are found either way. */}
    <HashRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
)
