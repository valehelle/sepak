import { Link } from 'react-router'

/** The index deliberately lists nothing. A session is reached by its own
 *  link, shared in the group chat -- publishing every fixture at a guessable
 *  address invited strangers to browse them. Organisers still see the full
 *  list on /admin, behind the allowlist. */
export default function Home() {
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
      <Link to="/admin" className="font-kit text-[13px] text-white/40 underline decoration-white/20 underline-offset-4">
        Admin
      </Link>
    </div>
  )
}
