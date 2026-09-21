import { Link, Navigate } from 'react-router'
import { recallSession } from '../lib/lastSession'
import { isStandalone } from '../lib/pushCapability'

/** The index deliberately lists nothing. A session is reached by its own
 *  link, shared in the group chat -- publishing every fixture at a guessable
 *  address invited strangers to browse them. Organisers still see the full
 *  list on /admin, behind the allowlist. */
export default function Home() {
  // The app is installable, so this page is now also what the home-screen
  // icon opens. Somebody who launched it from their icon wants the session
  // they were looking at, not an instruction to go and find a link.
  const last = recallSession()
  if (last !== null && isStandalone()) return <Navigate to={`/s/${last}`} replace />

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="h-4 w-4 rounded-sm bg-merah" />
        <span className="h-4 w-4 rounded-sm bg-putih" />
        <span className="h-4 w-4 rounded-sm bg-kuning" />
      </div>
      <h1 className="font-kit text-4xl font-bold uppercase leading-none tracking-tight text-white">
        Geng Turun Peluh
      </h1>
      <p className="font-sans text-[15px] leading-relaxed text-white/70">
        Buka pautan sesi yang dikongsi dalam kumpulan WhatsApp untuk pilih posisi anda.
      </p>
      {last !== null && (
        <Link
          to={`/s/${last}`}
          className="rounded-lg bg-turf px-4 py-2.5 text-center font-kit text-[15px] font-semibold text-white active:bg-turf-lit"
        >
          Buka sesi terakhir anda
        </Link>
      )}
      <Link to="/admin" className="font-kit text-[13px] text-white/40 underline decoration-white/20 underline-offset-4">
        Admin
      </Link>
    </div>
  )
}
