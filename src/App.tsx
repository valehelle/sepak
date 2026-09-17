import { Route, Routes } from 'react-router'
import Admin from './routes/Admin'
import Home from './routes/Home'
import SessionPage from './routes/SessionPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/s/:id" element={<SessionPage />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<p className="p-6">Halaman tak dijumpai.</p>} />
    </Routes>
  )
}
