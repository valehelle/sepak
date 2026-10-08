import { Route, Routes } from 'react-router'
import { NewPasswordSheet } from './components/NewPasswordSheet'
import Admin from './routes/Admin'
import Home from './routes/Home'
import SessionPage from './routes/SessionPage'

export default function App() {
  return (
    <>
      <NewPasswordSheet />
      <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/s/:id" element={<SessionPage />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<p className="p-6">Halaman tak dijumpai.</p>} />
      </Routes>
    </>
  )
}
